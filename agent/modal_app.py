"""Modal deployment for Treasury LangGraph Agent + FAISS Knowledge Base.

Exposes:
  - POST /agent/stream  — AG-UI compatible SSE streaming endpoint
  - POST /kb/search     — search the FAISS knowledge base
  - POST /kb/sync       — trigger Supabase → FAISS sync
  - POST /kb/add_file   — index a new file into the KB
  - GET  /health        — health check
"""

import os
import json
import logging
import modal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Modal Image
# ---------------------------------------------------------------------------

from pathlib import Path

_AGENT_DIR = Path(__file__).parent
_PROJECT_ROOT = _AGENT_DIR.parent
_DOC_DIR = _PROJECT_ROOT / "doc"

def _download_hf_model():
    """Pre-download the sentence-transformers model during image build."""
    from sentence_transformers import SentenceTransformer
    SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

agent_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("freetds-dev")
    .pip_install(
        "langchain>=0.3.0",
        "langchain-openai>=0.3.0",
        "langchain-community>=0.3.0",
        "langchain-huggingface>=0.1.0",
        "langgraph>=0.2.0",
        "langsmith>=0.2.0",
        "faiss-cpu>=1.8.0",
        "sentence-transformers>=2.2.0",
        "supabase>=2.0.0",
        "openpyxl>=3.1.0",
        "pandas>=2.0.0",
        "tavily-python>=0.5.0",
        "matplotlib>=3.8.0",
        "seaborn>=0.13.0",
        "numpy>=1.26.0",
        "sse-starlette>=2.0.0",
        "starlette>=0.38.0",
        "uvicorn>=0.30.0",
        "httpx>=0.27.0",
        "python-dotenv>=1.0.0",
        "pymssql>=2.2.0",
        "kafka-python>=2.0.0",
    )
    .run_function(_download_hf_model)
    .add_local_dir(str(_AGENT_DIR), remote_path="/app/agent")
    .add_local_dir(str(_DOC_DIR), remote_path="/app/doc")
)

app = modal.App(
    name="treasury-copilot-agent",
    image=agent_image,
)

# Modal Secrets — set via `modal secret create`
treasury_secret = modal.Secret.from_name(
    "treasury-copilot-secrets",
    required_keys=[
        "OPENROUTER_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "LANGCHAIN_API_KEY",
        "TAVILY_API_KEY",
    ],
)

# Persistent volume for FAISS index
faiss_volume = modal.Volume.from_name("treasury-faiss-index", create_if_missing=True)


# ---------------------------------------------------------------------------
# ASGI Web App
# ---------------------------------------------------------------------------

@app.function(
    secrets=[treasury_secret],
    volumes={"/data/faiss": faiss_volume},
    timeout=600,
    memory=4096,
    cpu=2.0,
)
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def web():
    import sys
    sys.path.insert(0, "/app")

    import httpx as _httpx  # stored so closures can reference it
    from starlette.applications import Starlette
    from starlette.routing import Route
    from starlette.requests import Request
    from starlette.responses import JSONResponse
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from sse_starlette.sse import EventSourceResponse

    # Set env vars
    os.environ["FAISS_INDEX_DIR"] = "/data/faiss"
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = "treasury-root-agent"
    os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"
    os.environ.setdefault("OPENROUTER_MODEL", "gpt-oss-120b")

    # Sub-agent URLs (separate Modal deployments)
    os.environ["ANALYTICS_AGENT_URL"] = "https://levinnovation--treasury-analytics-agent-web.modal.run"
    os.environ["DATA_SERVICE_AGENT_URL"] = "https://levinnovation--treasury-data-service-agent-web.modal.run"

    # Module-level reference for httpx so inner closures can use it
    http_client = _httpx

    from agent.graph import get_graph, SYSTEM_PROMPT
    from agent.knowledge_base import (
        build_index_from_local_files,
        load_index,
        search_kb,
        sync_from_supabase,
        add_file_to_kb,
        get_vectorstore,
        full_sync,
        incremental_sync,
        start_auto_sync,
        get_sync_stats,
    )
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

    # Lazy KB initialization — build on first search, not on startup
    _kb_initialized = False
    _auto_sync_started = False

    def _ensure_kb():
        nonlocal _kb_initialized, _auto_sync_started
        if _kb_initialized:
            return
        vs = load_index()
        if vs is None:
            logger.info("Building unified FAISS index (all sources)...")
            os.environ.setdefault("DOC_DIR", "/app/doc")
            full_sync()
            faiss_volume.commit()
            logger.info("FAISS index built and committed to volume")
        _kb_initialized = True
        # Start 4-min auto-sync daemon
        if not _auto_sync_started:
            start_auto_sync()
            _auto_sync_started = True
            logger.info("KB auto-sync daemon started (4-min interval)")

    # ------------------------------------------------------------------
    # AG-UI SSE Streaming Endpoint
    # ------------------------------------------------------------------
    async def agent_stream(request: Request):
        """AG-UI compatible streaming endpoint.
        Accepts: { messages: [{role, content}], threadId?, runId? }
        Streams: AG-UI protocol events via SSE
        """
        body = await request.json()
        raw_messages = body.get("messages", [])
        thread_id = body.get("threadId", "default")
        run_id = body.get("runId", "")

        # Convert to LangChain messages — truncate to last 20 messages
        # to prevent context overflow (131k token limit)
        recent_messages = raw_messages[-20:] if len(raw_messages) > 20 else raw_messages
        lc_messages = [SystemMessage(content=SYSTEM_PROMPT)]
        for msg in recent_messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            # Truncate very long messages to ~4000 chars
            if len(content) > 4000:
                content = content[:4000] + "\n[...truncado...]"
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))

        graph = get_graph()

        async def event_generator():
            import uuid

            # AG-UI: run started
            yield {
                "event": "RUN_STARTED",
                "data": json.dumps({
                    "threadId": thread_id,
                    "runId": run_id or str(uuid.uuid4()),
                }),
            }

            # AG-UI: text message start
            msg_id = str(uuid.uuid4())
            yield {
                "event": "TEXT_MESSAGE_START",
                "data": json.dumps({
                    "messageId": msg_id,
                    "role": "assistant",
                }),
            }

            full_text = ""
            try:
                async for event in graph.astream_events(
                    {"messages": lc_messages},
                    version="v2",
                ):
                    kind = event.get("event", "")

                    # Stream text tokens
                    if kind == "on_chat_model_stream":
                        chunk = event.get("data", {}).get("chunk")
                        if chunk and hasattr(chunk, "content") and chunk.content:
                            token = chunk.content
                            full_text += token
                            yield {
                                "event": "TEXT_MESSAGE_CONTENT",
                                "data": json.dumps({
                                    "messageId": msg_id,
                                    "delta": token,
                                }),
                            }

                    # Tool calls
                    elif kind == "on_tool_start":
                        tool_name = event.get("name", "unknown")
                        tool_input = event.get("data", {}).get("input", {})
                        yield {
                            "event": "TOOL_CALL_START",
                            "data": json.dumps({
                                "toolCallId": event.get("run_id", ""),
                                "toolCallName": tool_name,
                                "args": tool_input if isinstance(tool_input, dict) else {"input": str(tool_input)},
                            }),
                        }

                    elif kind == "on_tool_end":
                        tool_output = event.get("data", {}).get("output", "")
                        if hasattr(tool_output, "content"):
                            tool_output = tool_output.content
                        tool_str = str(tool_output)

                        # Extract base64 images via JSON parsing (robust)
                        extracted_images = []
                        try:
                            parsed = json.loads(tool_str) if isinstance(tool_str, str) else None
                            if isinstance(parsed, dict) and "images" in parsed:
                                for img in parsed["images"]:
                                    if isinstance(img, str) and len(img) > 100:
                                        extracted_images.append(img)
                                # Replace images in parsed dict so LLM doesn't see base64
                                parsed["images"] = [f"<chart_{i+1}_rendered>" for i in range(len(extracted_images))]
                                tool_str = json.dumps(parsed)
                        except (json.JSONDecodeError, TypeError, ValueError):
                            pass

                        # Emit IMAGE events for extracted images
                        for img_b64 in extracted_images:
                            yield {
                                "event": "IMAGE",
                                "data": json.dumps({
                                    "messageId": msg_id,
                                    "base64": img_b64,
                                }),
                            }

                        yield {
                            "event": "TOOL_CALL_END",
                            "data": json.dumps({
                                "toolCallId": event.get("run_id", ""),
                                "result": tool_str[:2000],
                            }),
                        }

            except Exception as e:
                logger.error(f"Agent error: {e}")
                error_text = f"\n\n⚠️ Error: {str(e)}"
                yield {
                    "event": "TEXT_MESSAGE_CONTENT",
                    "data": json.dumps({
                        "messageId": msg_id,
                        "delta": error_text,
                    }),
                }

            # AG-UI: text message end
            yield {
                "event": "TEXT_MESSAGE_END",
                "data": json.dumps({
                    "messageId": msg_id,
                }),
            }

            # AG-UI: run finished
            yield {
                "event": "RUN_FINISHED",
                "data": json.dumps({
                    "threadId": thread_id,
                    "runId": run_id or msg_id,
                }),
            }

        return EventSourceResponse(event_generator())

    # ------------------------------------------------------------------
    # KB Endpoints
    # ------------------------------------------------------------------
    async def kb_search(request: Request):
        _ensure_kb()
        body = await request.json()
        query = body.get("query", "")
        k = body.get("k", 5)
        results = search_kb(query, k=k)
        return JSONResponse({"results": results, "query": query})

    async def kb_sync(request: Request):
        _ensure_kb()
        result = full_sync()
        faiss_volume.commit()
        return JSONResponse(result)

    async def kb_stats(request: Request):
        """Return KB sync statistics: total chunks, sources, last sync time."""
        _ensure_kb()
        stats = get_sync_stats()
        return JSONResponse(stats)

    async def kb_cdc_refresh(request: Request):
        """CDC-triggered incremental KB refresh. Called by CDC pipeline after commits."""
        _ensure_kb()
        body = await request.json()
        table = body.get("table", "")
        schema = body.get("schema", "tms")
        rows = body.get("rows", [])
        if not table or not rows:
            # If no specific rows, do a full sync
            result = full_sync()
            faiss_volume.commit()
            return JSONResponse({"mode": "full_sync", **result})
        count = incremental_sync(table, schema, rows)
        faiss_volume.commit()
        return JSONResponse({"mode": "incremental", "table": table, "chunks_added": count})

    async def kb_add_file(request: Request):
        _ensure_kb()
        body = await request.json()
        file_path = body.get("file_path", "")
        source_name = body.get("source_name", "uploaded_file")
        count = add_file_to_kb(file_path, source_name)
        faiss_volume.commit()
        return JSONResponse({"indexed_chunks": count, "source": source_name})

    # ------------------------------------------------------------------
    # File Upload → KB Indexing
    # ------------------------------------------------------------------
    async def kb_upload(request: Request):
        """Accept multipart file upload, save to /tmp, index into FAISS KB."""
        _ensure_kb()
        import tempfile
        from starlette.datastructures import UploadFile

        form = await request.form()
        uploaded: UploadFile = form.get("file")
        if not uploaded or not uploaded.filename:
            return JSONResponse({"error": "No file uploaded"}, status_code=400)

        # Save to temp file
        suffix = "." + uploaded.filename.rsplit(".", 1)[-1] if "." in uploaded.filename else ""
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir="/tmp") as tmp:
            content = await uploaded.read()
            tmp.write(content)
            tmp_path = tmp.name

        source_name = uploaded.filename
        count = add_file_to_kb(tmp_path, source_name)
        faiss_volume.commit()

        # Clean up
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        return JSONResponse({
            "indexed_chunks": count,
            "source": source_name,
            "file_size": len(content),
        })

    # ------------------------------------------------------------------
    # Chat Session Persistence (Supabase)
    # ------------------------------------------------------------------
    _sb_url = os.environ.get("SUPABASE_URL", "")
    _sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    def _sb_headers():
        return {
            "apikey": _sb_key,
            "Authorization": f"Bearer {_sb_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def sessions_list(request: Request):
        """List chat sessions, newest first."""
        params = request.query_params
        limit = int(params.get("limit", "50"))
        resp = http_client.get(
            f"{_sb_url}/rest/v1/treasury_chat_sessions?order=updated_at.desc&limit={limit}",
            headers=_sb_headers(),
            timeout=15.0,
        )
        return JSONResponse(resp.json() if resp.status_code == 200 else [])

    async def sessions_create(request: Request):
        """Create a new chat session."""
        body = await request.json()
        title = body.get("title", "Nueva conversación")
        resp = http_client.post(
            f"{_sb_url}/rest/v1/treasury_chat_sessions",
            json={"title": title},
            headers=_sb_headers(),
            timeout=15.0,
        )
        if resp.status_code in (200, 201):
            rows = resp.json()
            return JSONResponse(rows[0] if isinstance(rows, list) and rows else rows)
        return JSONResponse({"error": resp.text}, status_code=resp.status_code)

    async def sessions_delete(request: Request):
        """Delete a chat session and its messages."""
        session_id = request.path_params["session_id"]
        # Delete messages first
        http_client.delete(
            f"{_sb_url}/rest/v1/treasury_chat_messages?session_id=eq.{session_id}",
            headers=_sb_headers(),
            timeout=15.0,
        )
        http_client.delete(
            f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{session_id}",
            headers=_sb_headers(),
            timeout=15.0,
        )
        return JSONResponse({"deleted": True})

    async def sessions_update(request: Request):
        """Update session title."""
        session_id = request.path_params["session_id"]
        body = await request.json()
        resp = http_client.patch(
            f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{session_id}",
            json=body,
            headers=_sb_headers(),
            timeout=15.0,
        )
        if resp.status_code in (200, 204):
            rows = resp.json() if resp.text else []
            return JSONResponse(rows[0] if isinstance(rows, list) and rows else {"ok": True})
        return JSONResponse({"error": resp.text}, status_code=resp.status_code)

    async def messages_list(request: Request):
        """List messages for a session."""
        session_id = request.path_params["session_id"]
        resp = http_client.get(
            f"{_sb_url}/rest/v1/treasury_chat_messages?session_id=eq.{session_id}&order=created_at.asc",
            headers=_sb_headers(),
            timeout=15.0,
        )
        return JSONResponse(resp.json() if resp.status_code == 200 else [])

    async def messages_save(request: Request):
        """Save a message to a session."""
        session_id = request.path_params["session_id"]
        body = await request.json()
        msg = {
            "session_id": session_id,
            "role": body.get("role", "user"),
            "content": body.get("content", ""),
            "tool_calls": json.dumps(body.get("tool_calls", [])),
            "images": json.dumps(body.get("images", [])),
        }
        resp = http_client.post(
            f"{_sb_url}/rest/v1/treasury_chat_messages",
            json=msg,
            headers=_sb_headers(),
            timeout=15.0,
        )
        # Fallback: if columns don't exist yet, retry without them
        if resp.status_code not in (200, 201):
            msg_minimal = {
                "session_id": session_id,
                "role": body.get("role", "user"),
                "content": body.get("content", ""),
            }
            resp = http_client.post(
                f"{_sb_url}/rest/v1/treasury_chat_messages",
                json=msg_minimal,
                headers=_sb_headers(),
                timeout=15.0,
            )
        if resp.status_code in (200, 201):
            rows = resp.json()
            # Update session updated_at
            http_client.patch(
                f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{session_id}",
                json={"updated_at": "now()"},
                headers=_sb_headers(),
                timeout=10.0,
            )
            return JSONResponse(rows[0] if isinstance(rows, list) and rows else rows)
        return JSONResponse({"error": resp.text}, status_code=resp.status_code)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    async def health(request: Request):
        from agent.llm_fallback import get_fallback_status
        vs = get_vectorstore()
        return JSONResponse({
            "status": "ok",
            "kb_loaded": vs is not None,
            "model": os.environ.get("OPENROUTER_MODEL", "gpt-oss-120b"),
            "architecture": "decoupled",
            "langsmith_project": "treasury-root-agent",
            "sub_agents": {
                "analytics": os.environ.get("ANALYTICS_AGENT_URL", "in-process"),
                "data_service": os.environ.get("DATA_SERVICE_AGENT_URL", "in-process"),
            },
            "llm_fallback": get_fallback_status(),
        })

    # ------------------------------------------------------------------
    # Import shared route handlers (Data Model, CDC, PcGraf, TICA, Code Mapping)
    # ------------------------------------------------------------------
    from agent.dashboard_routes import (
        data_model_schema, kafka_status, erp_schema, data_curation_save,
        cdc_status, cdc_poll_now, cdc_table_registry,
        pcgraf_query, pcgraf_databases, pcgraf_tables, pcgraf_health,
        pcgraf_backup, pcgraf_backup_list,
        tica_health, tica_search_duas, tica_lookup_partida, tica_conciliate,
        code_mapping_match, code_mapping_save, code_mapping_list,
    )
    from agent.projects_api import (
        projects_kpis, projects_portfolio, projects_contracts, projects_alerts,
        projects_gantt, projects_area_breakdown, projects_collections,
        projects_forecast, projects_aging, projects_curation_save,
    )
    from agent.erp_modules_api import (
        erp_facturas, erp_factura_detalle, erp_facturas_por_negocio,
        erp_facturas_mensual, erp_facturas_kpis, erp_top_clientes,
        erp_contratos, erp_contrato_detalle, erp_hitos, erp_table_schema,
        contract_pdf_schema, contract_pdf_list, contract_pdf_serve,
    )
    from agent.tms_engine import (
        tms_list_entities, tms_query, tms_get_one, tms_create, tms_update,
        tms_delete, tms_approve, tms_audit_log, tms_notifications,
        tms_mark_notification_read, tms_business_rules,
    )
    from agent.tms_core_modules import (
        cash_position, cash_forecast, cash_liquidity_gap, cash_scenarios,
        cxp_dashboard, cxp_payment_schedule,
        cxc_dashboard, cxc_collection_worklist,
        invoicing_dashboard, invoicing_contract_detail,
        project_finance_dashboard, project_budget_vs_actual,
        fx_dashboard, fx_scenario_sim,
        debt_dashboard, debt_instrument_detail,
        recon_dashboard, recon_auto_match,
        mrp_dashboard, mrp_reorder_recommendations,
        board_executive_dashboard, board_bu_comparison,
        admin_system_health, admin_cdc_status,
        bank_accounts_list, bank_statement_import, bank_payment_initiate,
        einvoice_status, einvoice_submit, einvoice_webhook,
        pcgraf_writeback_status, pcgraf_writeback_push,
        integration_connections_list, integration_connect, integration_disconnect, integration_test,
        sync_jobs_list, sync_trigger, sync_schedule_list, sync_schedule_update,
    )

    # ------------------------------------------------------------------
    # Starlette App
    # ------------------------------------------------------------------
    routes = [
        Route("/agent/stream", agent_stream, methods=["POST"]),
        # KB
        Route("/kb/search", kb_search, methods=["POST"]),
        Route("/kb/sync", kb_sync, methods=["POST"]),
        Route("/kb/stats", kb_stats, methods=["GET"]),
        Route("/kb/cdc_refresh", kb_cdc_refresh, methods=["POST"]),
        Route("/kb/add_file", kb_add_file, methods=["POST"]),
        Route("/kb/upload", kb_upload, methods=["POST"]),
        # Chat sessions
        Route("/sessions", sessions_list, methods=["GET"]),
        Route("/sessions", sessions_create, methods=["POST"]),
        Route("/sessions/{session_id}", sessions_update, methods=["PATCH"]),
        Route("/sessions/{session_id}", sessions_delete, methods=["DELETE"]),
        Route("/sessions/{session_id}/messages", messages_list, methods=["GET"]),
        Route("/sessions/{session_id}/messages", messages_save, methods=["POST"]),
        # Health
        Route("/health", health, methods=["GET"]),
        # PcGraf ERP SQL Server
        Route("/pcgraf/query", pcgraf_query, methods=["POST"]),
        Route("/pcgraf/databases", pcgraf_databases, methods=["GET"]),
        Route("/pcgraf/tables", pcgraf_tables, methods=["GET"]),
        Route("/pcgraf/health", pcgraf_health, methods=["GET"]),
        Route("/pcgraf/backup", pcgraf_backup, methods=["POST"]),
        Route("/pcgraf/backups", pcgraf_backup_list, methods=["GET"]),
        # TICA / Aduanas
        Route("/tica/health", tica_health, methods=["GET"]),
        Route("/tica/duas", tica_search_duas, methods=["POST"]),
        Route("/tica/partida", tica_lookup_partida, methods=["GET"]),
        Route("/tica/conciliate", tica_conciliate, methods=["POST"]),
        # AI Code Mapping
        Route("/code-mapping/match", code_mapping_match, methods=["POST"]),
        Route("/code-mapping/save", code_mapping_save, methods=["POST"]),
        Route("/code-mapping/list", code_mapping_list, methods=["GET"]),
        # CDC (Change Data Capture)
        Route("/cdc/status", cdc_status, methods=["GET"]),
        Route("/cdc/poll", cdc_poll_now, methods=["POST"]),
        Route("/cdc/registry", cdc_table_registry, methods=["GET"]),
        # Data Model Dashboard
        Route("/data-model/schema", data_model_schema, methods=["GET"]),
        Route("/data-model/kafka", kafka_status, methods=["GET"]),
        Route("/data-model/erp-schema", erp_schema, methods=["GET"]),
        Route("/data-model/curation", data_curation_save, methods=["POST"]),
        # Projects & Contracts BI
        Route("/projects/kpis", projects_kpis, methods=["GET"]),
        Route("/projects/portfolio", projects_portfolio, methods=["GET"]),
        Route("/projects/contracts", projects_contracts, methods=["GET"]),
        Route("/projects/alerts", projects_alerts, methods=["GET"]),
        Route("/projects/gantt", projects_gantt, methods=["GET"]),
        Route("/projects/areas", projects_area_breakdown, methods=["GET"]),
        Route("/projects/collections", projects_collections, methods=["GET"]),
        Route("/projects/forecast", projects_forecast, methods=["GET"]),
        Route("/projects/aging", projects_aging, methods=["GET"]),
        Route("/projects/curation", projects_curation_save, methods=["POST"]),
        # ERP Modules
        Route("/erp/facturas", erp_facturas, methods=["GET"]),
        Route("/erp/factura-detalle", erp_factura_detalle, methods=["GET"]),
        Route("/erp/facturas-negocio", erp_facturas_por_negocio, methods=["GET"]),
        Route("/erp/facturas-mensual", erp_facturas_mensual, methods=["GET"]),
        Route("/erp/facturas-kpis", erp_facturas_kpis, methods=["GET"]),
        Route("/erp/top-clientes", erp_top_clientes, methods=["GET"]),
        Route("/erp/contratos", erp_contratos, methods=["GET"]),
        Route("/erp/contrato-detalle", erp_contrato_detalle, methods=["GET"]),
        Route("/erp/hitos", erp_hitos, methods=["GET"]),
        Route("/erp/table-schema", erp_table_schema, methods=["GET"]),
        # Contract PDF Viewer (CEM0.IM00)
        Route("/contracts/pdf/schema", contract_pdf_schema, methods=["GET"]),
        Route("/contracts/pdf/list", contract_pdf_list, methods=["GET"]),
        Route("/contracts/pdf/{id}", contract_pdf_serve, methods=["GET"]),
        # TMS Phase 2: Core Module Analytics
        Route("/tms/cash/position", cash_position, methods=["GET"]),
        Route("/tms/cash/forecast", cash_forecast, methods=["GET"]),
        Route("/tms/cash/liquidity-gap", cash_liquidity_gap, methods=["GET"]),
        Route("/tms/cash/scenarios", cash_scenarios, methods=["GET"]),
        Route("/tms/cxp/dashboard", cxp_dashboard, methods=["GET"]),
        Route("/tms/cxp/schedule", cxp_payment_schedule, methods=["GET"]),
        Route("/tms/cxc/dashboard", cxc_dashboard, methods=["GET"]),
        Route("/tms/cxc/worklist", cxc_collection_worklist, methods=["GET"]),
        Route("/tms/invoicing/dashboard", invoicing_dashboard, methods=["GET"]),
        Route("/tms/invoicing/contract/{id}", invoicing_contract_detail, methods=["GET"]),
        # TMS Phase 3: Advanced Module Analytics
        Route("/tms/projects/dashboard", project_finance_dashboard, methods=["GET"]),
        Route("/tms/projects/budget-vs-actual", project_budget_vs_actual, methods=["GET"]),
        Route("/tms/fx/dashboard", fx_dashboard, methods=["GET"]),
        Route("/tms/fx/scenarios", fx_scenario_sim, methods=["GET"]),
        Route("/tms/debt/dashboard", debt_dashboard, methods=["GET"]),
        Route("/tms/debt/instrument/{id}", debt_instrument_detail, methods=["GET"]),
        Route("/tms/recon/dashboard", recon_dashboard, methods=["GET"]),
        Route("/tms/recon/auto-match", recon_auto_match, methods=["POST"]),
        # TMS Phase 4: Intelligence & Polish
        Route("/tms/mrp/dashboard", mrp_dashboard, methods=["GET"]),
        Route("/tms/mrp/reorder", mrp_reorder_recommendations, methods=["GET"]),
        Route("/tms/board/executive", board_executive_dashboard, methods=["GET"]),
        Route("/tms/board/bu-comparison", board_bu_comparison, methods=["GET"]),
        Route("/tms/admin/health", admin_system_health, methods=["GET"]),
        Route("/tms/admin/cdc-status", admin_cdc_status, methods=["GET"]),
        # TMS Phase 5: Optimization
        Route("/tms/bank/accounts", bank_accounts_list, methods=["GET"]),
        Route("/tms/bank/import", bank_statement_import, methods=["POST"]),
        Route("/tms/bank/pay", bank_payment_initiate, methods=["POST"]),
        Route("/tms/einvoice/status", einvoice_status, methods=["GET"]),
        Route("/tms/einvoice/submit", einvoice_submit, methods=["POST"]),
        Route("/tms/einvoice/webhook", einvoice_webhook, methods=["POST"]),
        Route("/tms/writeback/status", pcgraf_writeback_status, methods=["GET"]),
        Route("/tms/writeback/push", pcgraf_writeback_push, methods=["POST"]),
        # TMS Phase 5: Integration Management & Sync Orchestration
        Route("/tms/integrations", integration_connections_list, methods=["GET"]),
        Route("/tms/integrations/connect", integration_connect, methods=["POST"]),
        Route("/tms/integrations/disconnect", integration_disconnect, methods=["POST"]),
        Route("/tms/integrations/test", integration_test, methods=["POST"]),
        Route("/tms/sync/jobs", sync_jobs_list, methods=["GET"]),
        Route("/tms/sync/trigger", sync_trigger, methods=["POST"]),
        Route("/tms/sync/schedule", sync_schedule_list, methods=["GET"]),
        Route("/tms/sync/schedule", sync_schedule_update, methods=["POST"]),
        # TMS Engine: Data Virtualization Layer + Transactional CRUD
        Route("/tms/entities", tms_list_entities, methods=["GET"]),
        Route("/tms/audit", tms_audit_log, methods=["GET"]),
        Route("/tms/rules", tms_business_rules, methods=["GET"]),
        Route("/tms/notifications", tms_notifications, methods=["GET"]),
        Route("/tms/notifications/{id}/read", tms_mark_notification_read, methods=["PUT"]),
        Route("/tms/{entity}/{id}/approve", tms_approve, methods=["POST"]),
        Route("/tms/{entity}/{id}", tms_get_one, methods=["GET"]),
        Route("/tms/{entity}/{id}", tms_update, methods=["PUT"]),
        Route("/tms/{entity}/{id}", tms_delete, methods=["DELETE"]),
        Route("/tms/{entity}", tms_query, methods=["GET"]),
        Route("/tms/{entity}", tms_create, methods=["POST"]),
    ]

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ]

    return Starlette(routes=routes, middleware=middleware)
