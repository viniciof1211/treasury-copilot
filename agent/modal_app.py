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
    )
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

    # Lazy KB initialization — build on first search, not on startup
    _kb_initialized = False

    def _ensure_kb():
        nonlocal _kb_initialized
        if _kb_initialized:
            return
        vs = load_index()
        if vs is None:
            logger.info("Building FAISS index from /app/doc...")
            build_index_from_local_files("/app/doc")
            faiss_volume.commit()
            logger.info("FAISS index built and committed to volume")
        _kb_initialized = True

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
        count = sync_from_supabase()
        faiss_volume.commit()
        return JSONResponse({"synced_chunks": count})

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
        })

    # ------------------------------------------------------------------
    # Starlette App
    # ------------------------------------------------------------------
    routes = [
        Route("/agent/stream", agent_stream, methods=["POST"]),
        # KB
        Route("/kb/search", kb_search, methods=["POST"]),
        Route("/kb/sync", kb_sync, methods=["POST"]),
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
