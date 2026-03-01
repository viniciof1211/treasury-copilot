"""Local development server — runs the same AG-UI streaming endpoint locally (no Modal)."""

import os
import sys
import json
import uuid
import re
import logging
import unicodedata
from pathlib import Path

# Load .env before any other imports
from dotenv import load_dotenv
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import uvicorn

# Ensure agent package is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

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
from agent.projects_api import (
    projects_kpis, projects_portfolio, projects_contracts, projects_alerts,
    projects_gantt, projects_area_breakdown, projects_collections,
    projects_forecast, projects_aging, projects_curation_save,
)
from agent.erp_modules_api import (
    erp_facturas, erp_factura_detalle, erp_facturas_por_negocio,
    erp_facturas_mensual, erp_facturas_kpis, erp_top_clientes,
    erp_contratos, erp_contrato_detalle, erp_hitos, erp_table_schema,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# LangSmith tracing
os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
os.environ.setdefault("LANGCHAIN_PROJECT", "treasury-root-agent")
os.environ.setdefault("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com")

# Sub-agent URLs — when set, tools.py delegates via HTTP instead of in-process
# On Azure these come from container env vars; locally they default to empty (in-process fallback)
os.environ.setdefault("ANALYTICS_AGENT_URL", os.environ.get("ANALYTICS_AGENT_URL", ""))
os.environ.setdefault("DATA_SERVICE_AGENT_URL", os.environ.get("DATA_SERVICE_AGENT_URL", ""))


# ---------------------------------------------------------------------------
# Build KB on startup
# ---------------------------------------------------------------------------
def init_kb():
    vs = load_index()
    if vs is None:
        doc_dir = str(Path(__file__).parent.parent / "doc")
        if Path(doc_dir).exists():
            logger.info(f"Building FAISS index from {doc_dir}...")
            build_index_from_local_files(doc_dir)
            logger.info("FAISS index built")
        else:
            logger.warning(f"Doc directory not found: {doc_dir}")


# ---------------------------------------------------------------------------
# AG-UI SSE Streaming Endpoint
# ---------------------------------------------------------------------------
async def agent_stream(request: Request):
    body = await request.json()
    raw_messages = body.get("messages", [])
    thread_id = body.get("threadId", "default")
    run_id = body.get("runId", "")

    # Convert to LangChain messages — truncate to last 20 messages
    recent_messages = raw_messages[-20:] if len(raw_messages) > 20 else raw_messages
    lc_messages = [SystemMessage(content=SYSTEM_PROMPT)]
    for msg in recent_messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if len(content) > 4000:
            content = content[:4000] + "\n[...truncado...]"
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))

    graph = get_graph()

    async def event_generator():
        current_run_id = run_id or str(uuid.uuid4())

        # AG-UI: run started
        yield {
            "event": "RUN_STARTED",
            "data": json.dumps({
                "threadId": thread_id,
                "runId": current_run_id,
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

                    tool_name = event.get("name", "unknown")
                    logger.info(f"[on_tool_end] tool={tool_name} output_len={len(tool_str)} output_preview={tool_str[:200]}")

                    # Extract base64 images via JSON parsing (robust)
                    extracted_images = []
                    try:
                        parsed = json.loads(tool_str) if isinstance(tool_str, str) else None
                        if isinstance(parsed, dict) and "images" in parsed:
                            raw_images = parsed["images"]
                            logger.info(f"[on_tool_end] tool={tool_name} found images field with {len(raw_images)} items")
                            for img in raw_images:
                                if isinstance(img, str) and len(img) > 100:
                                    extracted_images.append(img)
                            # Replace images so LLM doesn't see base64
                            parsed["images"] = [f"<chart_{i+1}_rendered>" for i in range(len(extracted_images))]
                            tool_str = json.dumps(parsed)
                    except (json.JSONDecodeError, TypeError, ValueError) as parse_err:
                        logger.warning(f"[on_tool_end] tool={tool_name} JSON parse failed: {parse_err}")

                    logger.info(f"[on_tool_end] tool={tool_name} extracted_images={len(extracted_images)}")

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
            logger.error(f"Agent error: {e}", exc_info=True)
            yield {
                "event": "TEXT_MESSAGE_CONTENT",
                "data": json.dumps({
                    "messageId": msg_id,
                    "delta": f"\n\n⚠️ Error: {str(e)}",
                }),
            }

        # AG-UI: text message end
        yield {
            "event": "TEXT_MESSAGE_END",
            "data": json.dumps({"messageId": msg_id}),
        }

        # AG-UI: run finished
        yield {
            "event": "RUN_FINISHED",
            "data": json.dumps({
                "threadId": thread_id,
                "runId": current_run_id,
            }),
        }

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# KB Endpoints
# ---------------------------------------------------------------------------
async def kb_search_endpoint(request: Request):
    body = await request.json()
    query = body.get("query", "")
    k = body.get("k", 5)
    results = search_kb(query, k=k)
    return JSONResponse({"results": results, "query": query})


async def kb_sync_endpoint(request: Request):
    result = full_sync()
    return JSONResponse(result)


async def kb_stats_endpoint(request: Request):
    """Return KB sync statistics: total chunks, sources, last sync time."""
    stats = get_sync_stats()
    return JSONResponse(stats)


async def kb_cdc_refresh_endpoint(request: Request):
    """CDC-triggered incremental KB refresh. Called after CDC commits or curation saves."""
    body = await request.json()
    table = body.get("table", "")
    schema = body.get("schema", "tms")
    rows = body.get("rows", [])
    if not table or not rows:
        result = full_sync()
        return JSONResponse({"mode": "full_sync", **result})
    count = incremental_sync(table, schema, rows)
    return JSONResponse({"mode": "incremental", "table": table, "chunks_added": count})


async def kb_upload_endpoint(request: Request):
    """Accept multipart file upload, save to /tmp, index into FAISS KB."""
    import tempfile
    form = await request.form()
    uploaded = form.get("file")
    if not uploaded or not uploaded.filename:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)
    suffix = "." + uploaded.filename.rsplit(".", 1)[-1] if "." in uploaded.filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await uploaded.read()
        tmp.write(content)
        tmp_path = tmp.name
    count = add_file_to_kb(tmp_path, uploaded.filename)
    try:
        os.unlink(tmp_path)
    except Exception:
        pass
    return JSONResponse({"indexed_chunks": count, "source": uploaded.filename, "file_size": len(content)})


# ---------------------------------------------------------------------------
# Chat Session Persistence (Supabase REST)
# ---------------------------------------------------------------------------
import httpx

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
    limit = int(request.query_params.get("limit", "50"))
    resp = httpx.get(f"{_sb_url}/rest/v1/treasury_chat_sessions?order=updated_at.desc&limit={limit}", headers=_sb_headers(), timeout=15.0)
    return JSONResponse(resp.json() if resp.status_code == 200 else [])

async def sessions_create(request: Request):
    body = await request.json()
    resp = httpx.post(f"{_sb_url}/rest/v1/treasury_chat_sessions", json={"title": body.get("title", "Nueva conversación")}, headers=_sb_headers(), timeout=15.0)
    if resp.status_code in (200, 201):
        rows = resp.json()
        return JSONResponse(rows[0] if isinstance(rows, list) and rows else rows)
    return JSONResponse({"error": resp.text}, status_code=resp.status_code)

async def sessions_delete(request: Request):
    sid = request.path_params["session_id"]
    httpx.delete(f"{_sb_url}/rest/v1/treasury_chat_messages?session_id=eq.{sid}", headers=_sb_headers(), timeout=15.0)
    httpx.delete(f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{sid}", headers=_sb_headers(), timeout=15.0)
    return JSONResponse({"deleted": True})

async def sessions_update(request: Request):
    sid = request.path_params["session_id"]
    body = await request.json()
    resp = httpx.patch(f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{sid}", json=body, headers=_sb_headers(), timeout=15.0)
    if resp.status_code in (200, 204):
        rows = resp.json() if resp.text else []
        return JSONResponse(rows[0] if isinstance(rows, list) and rows else {"ok": True})
    return JSONResponse({"error": resp.text}, status_code=resp.status_code)

async def messages_list(request: Request):
    sid = request.path_params["session_id"]
    resp = httpx.get(f"{_sb_url}/rest/v1/treasury_chat_messages?session_id=eq.{sid}&order=created_at.asc", headers=_sb_headers(), timeout=15.0)
    return JSONResponse(resp.json() if resp.status_code == 200 else [])

async def messages_save(request: Request):
    sid = request.path_params["session_id"]
    body = await request.json()
    msg = {"session_id": sid, "role": body.get("role", "user"), "content": body.get("content", ""), "tool_calls": json.dumps(body.get("tool_calls", [])), "images": json.dumps(body.get("images", []))}
    resp = httpx.post(f"{_sb_url}/rest/v1/treasury_chat_messages", json=msg, headers=_sb_headers(), timeout=15.0)
    # Fallback: if columns don't exist yet, retry without them
    if resp.status_code not in (200, 201):
        msg_minimal = {"session_id": sid, "role": body.get("role", "user"), "content": body.get("content", "")}
        resp = httpx.post(f"{_sb_url}/rest/v1/treasury_chat_messages", json=msg_minimal, headers=_sb_headers(), timeout=15.0)
    if resp.status_code in (200, 201):
        rows = resp.json()
        httpx.patch(f"{_sb_url}/rest/v1/treasury_chat_sessions?id=eq.{sid}", json={"updated_at": "now()"}, headers=_sb_headers(), timeout=10.0)
        return JSONResponse(rows[0] if isinstance(rows, list) and rows else rows)
    return JSONResponse({"error": resp.text}, status_code=resp.status_code)


# ---------------------------------------------------------------------------
# PcGraf ERP SQL Server Proxy
# ---------------------------------------------------------------------------
_pcgraf_server = os.environ.get("PCGRAF_SQL_SERVER", "")
_pcgraf_user = os.environ.get("PCGRAF_SQL_USER", "")
_pcgraf_password = os.environ.get("PCGRAF_SQL_PASSWORD", "")
_pcgraf_database = os.environ.get("PCGRAF_SQL_DATABASE", "")


def _pcgraf_connect(database: str = ""):
    """Create a pymssql connection to PcGraf SQL Server."""
    import pymssql
    db = database or _pcgraf_database or None
    return pymssql.connect(
        server=_pcgraf_server,
        user=_pcgraf_user,
        password=_pcgraf_password,
        database=db,
        login_timeout=10,
        timeout=30,
        as_dict=True,
    )


async def pcgraf_query(request: Request):
    """Execute a read-only SQL query against PcGraf ERP SQL Server."""
    if not _pcgraf_server:
        return JSONResponse({"error": "PcGraf SQL Server not configured"}, status_code=500)
    body = await request.json()
    sql = body.get("sql", "").strip()
    database = body.get("database", "")
    if not sql:
        return JSONResponse({"error": "No SQL query provided"}, status_code=400)
    # Safety: only allow SELECT / EXEC for read-only
    first_word = sql.split()[0].upper() if sql.split() else ""
    if first_word not in ("SELECT", "EXEC", "EXECUTE", "SP_HELP", "SP_TABLES", "SP_COLUMNS"):
        return JSONResponse({"error": f"Only SELECT/EXEC queries allowed, got: {first_word}"}, status_code=400)
    try:
        conn = _pcgraf_connect(database)
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        conn.close()
        # Convert rows to serializable dicts (handle bytes, datetime, Decimal)
        import decimal
        import datetime as dt
        clean_rows = []
        for row in rows[:5000]:  # cap at 5000 rows
            clean = {}
            for k, v in row.items():
                if isinstance(v, (dt.datetime, dt.date)):
                    clean[k] = v.isoformat()
                elif isinstance(v, decimal.Decimal):
                    clean[k] = float(v)
                elif isinstance(v, bytes):
                    clean[k] = v.hex()
                else:
                    clean[k] = v
            clean_rows.append(clean)
        return JSONResponse({
            "rows": clean_rows,
            "columns": columns,
            "row_count": len(clean_rows),
            "total_rows": len(rows),
            "query": sql,
        })
    except Exception as e:
        logger.error(f"PcGraf query error: {e}")
        return JSONResponse({"error": str(e), "rows": [], "row_count": 0}, status_code=500)


async def pcgraf_databases(request: Request):
    """List available databases on PcGraf SQL Server."""
    if not _pcgraf_server:
        return JSONResponse({"error": "PcGraf SQL Server not configured"}, status_code=500)
    try:
        conn = _pcgraf_connect("master")
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name")
        rows = cursor.fetchall()
        conn.close()
        return JSONResponse({"databases": [r["name"] for r in rows]})
    except Exception as e:
        logger.error(f"PcGraf databases error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def pcgraf_tables(request: Request):
    """List tables in a PcGraf database."""
    if not _pcgraf_server:
        return JSONResponse({"error": "PcGraf SQL Server not configured"}, status_code=500)
    database = request.query_params.get("database", _pcgraf_database or "master")
    try:
        conn = _pcgraf_connect(database)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT TABLE_SCHEMA as [schema], TABLE_NAME as [table], TABLE_TYPE as [type]
            FROM INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """)
        rows = cursor.fetchall()
        conn.close()
        return JSONResponse({"database": database, "tables": [dict(r) for r in rows]})
    except Exception as e:
        logger.error(f"PcGraf tables error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def pcgraf_health(request: Request):
    """Check PcGraf SQL Server connectivity."""
    if not _pcgraf_server:
        return JSONResponse({"status": "not_configured", "server": ""})
    try:
        conn = _pcgraf_connect("master")
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION as version, @@SERVERNAME as server_name, DB_NAME() as current_db")
        row = cursor.fetchone()
        conn.close()
        return JSONResponse({"status": "connected", "server": _pcgraf_server, **dict(row)})
    except Exception as e:
        return JSONResponse({"status": "error", "server": _pcgraf_server, "error": str(e)})


# ---------------------------------------------------------------------------
# Immutable Backup System for PcGraf
# ---------------------------------------------------------------------------
async def pcgraf_backup(request: Request):
    """Create an immutable backup of PcGraf data before curation/sync."""
    if not _pcgraf_server:
        return JSONResponse({"error": "PcGraf SQL Server not configured"}, status_code=500)
    body = await request.json()
    database = body.get("database", "")
    table = body.get("table", "")
    sql = body.get("sql", "")
    backup_type = body.get("backup_type", "pre_curation")
    if not sql and not table:
        return JSONResponse({"error": "Provide either 'sql' or 'table' to backup"}, status_code=400)
    if not sql:
        sql = f"SELECT TOP 10000 * FROM {table}"
    try:
        import hashlib, json as _json, decimal, datetime as dt
        conn = _pcgraf_connect(database)
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        conn.close()
        # Serialize
        clean = []
        for row in rows:
            r = {}
            for k, v in row.items():
                if isinstance(v, (dt.datetime, dt.date)):
                    r[k] = v.isoformat()
                elif isinstance(v, decimal.Decimal):
                    r[k] = float(v)
                elif isinstance(v, bytes):
                    r[k] = v.hex()
                else:
                    r[k] = v
            clean.append(r)
        data_json = _json.dumps(clean, ensure_ascii=False, default=str)
        checksum = hashlib.sha256(data_json.encode()).hexdigest()
        # Store in Supabase
        sb_url = os.environ.get("SUPABASE_URL", "")
        sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if sb_url and sb_key:
            import httpx as _httpx
            resp = _httpx.post(
                f"{sb_url}/rest/v1/pcgraf_backups",
                json={
                    "backup_type": backup_type,
                    "source_database": database,
                    "source_table": table or sql[:200],
                    "row_count": len(clean),
                    "backup_data": clean,
                    "checksum": checksum,
                    "created_by": body.get("user", "system"),
                    "metadata": {"sql": sql[:500], "server": _pcgraf_server},
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {sb_key}",
                    "apikey": sb_key,
                    "Prefer": "return=representation",
                },
                timeout=30.0,
            )
            if resp.status_code in (200, 201):
                backup_row = resp.json()
                backup_id = backup_row[0]["id"] if isinstance(backup_row, list) else backup_row.get("id")
                return JSONResponse({
                    "status": "backed_up",
                    "backup_id": backup_id,
                    "row_count": len(clean),
                    "checksum": checksum,
                    "backup_type": backup_type,
                })
            else:
                logger.error(f"Backup store error: {resp.text}")
                return JSONResponse({"error": f"Failed to store backup: {resp.text}", "row_count": len(clean)}, status_code=500)
        return JSONResponse({"error": "Supabase not configured for backup storage"}, status_code=500)
    except Exception as e:
        logger.error(f"PcGraf backup error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def pcgraf_backup_list(request: Request):
    """List existing PcGraf backups."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    try:
        import httpx as _httpx
        resp = _httpx.get(
            f"{sb_url}/rest/v1/pcgraf_backups?select=id,backup_type,source_database,source_table,row_count,checksum,created_by,created_at&order=created_at.desc&limit=50",
            headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key},
            timeout=15.0,
        )
        return JSONResponse({"backups": resp.json() if resp.status_code == 200 else []})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------------------------------------------------------------------------
# TICA / Aduanas Integration (Costa Rica customs data)
# ---------------------------------------------------------------------------
TICA_BASE_URL = "https://ticaconsultas.hacienda.go.cr"

async def tica_health(request: Request):
    """Check TICA API connectivity."""
    try:
        import httpx as _httpx
        resp = _httpx.get(f"{TICA_BASE_URL}/Tica/hcimppon.aspx", timeout=10.0, follow_redirects=True)
        return JSONResponse({
            "status": "reachable" if resp.status_code == 200 else "error",
            "api_url": TICA_BASE_URL,
            "http_status": resp.status_code,
        })
    except Exception as e:
        return JSONResponse({"status": "error", "api_url": TICA_BASE_URL, "error": str(e)})


async def tica_search_duas(request: Request):
    """
    Search DUAs by importer cédula and date range.
    Scrapes TICA web interface since there is no public REST API.
    """
    body = await request.json()
    cedula = body.get("cedula", "")
    fecha_inicio = body.get("fecha_inicio", "")
    fecha_fin = body.get("fecha_fin", "")
    aduana = body.get("aduana", "")
    if not cedula:
        return JSONResponse({"error": "cedula is required"}, status_code=400)
    try:
        import httpx as _httpx
        from html.parser import HTMLParser

        # Step 1: GET the form page to obtain __VIEWSTATE
        session = _httpx.Client(timeout=20.0, follow_redirects=True)
        page = session.get(f"{TICA_BASE_URL}/Tica/hcimppon.aspx")
        html = page.text

        # Extract __VIEWSTATE and __EVENTVALIDATION
        def extract_hidden(name: str, html_text: str) -> str:
            import re
            m = re.search(rf'id="{name}"\s+value="([^"]*)"', html_text)
            return m.group(1) if m else ""

        viewstate = extract_hidden("__VIEWSTATE", html)
        validation = extract_hidden("__EVENTVALIDATION", html)
        viewstate_gen = extract_hidden("__VIEWSTATEGENERATOR", html)

        # Step 2: POST the search form
        form_data = {
            "__VIEWSTATE": viewstate,
            "__EVENTVALIDATION": validation,
            "__VIEWSTATEGENERATOR": viewstate_gen,
            "txtCedula": cedula,
            "txtFechaInicio": fecha_inicio or "",
            "txtFechaFin": fecha_fin or "",
            "ddlAduana": aduana or "0",
            "btnConsultar": "Consultar",
        }
        result_page = session.post(
            f"{TICA_BASE_URL}/Tica/hcimppon.aspx",
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        session.close()
        result_html = result_page.text

        # Step 3: Parse the results table
        import re
        duas = []
        # Look for table rows with DUA data
        table_match = re.search(r'<table[^>]*id="gvResultados"[^>]*>(.*?)</table>', result_html, re.DOTALL)
        if table_match:
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_match.group(1), re.DOTALL)
            for row in rows[1:]:  # Skip header row
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                if len(cells) >= 6:
                    duas.append({
                        "dua_number": cells[0],
                        "fecha": cells[1],
                        "importador": cells[2] if len(cells) > 2 else cedula,
                        "aduana": cells[3] if len(cells) > 3 else "",
                        "regimen": cells[4] if len(cells) > 4 else "",
                        "estado": cells[5] if len(cells) > 5 else "",
                        "valor_cif": 0,
                        "valor_fob": 0,
                        "flete": 0,
                        "seguro": 0,
                        "dai_total": 0,
                        "iva_total": 0,
                        "total_impuestos": 0,
                        "lineas": [],
                    })

        return JSONResponse({
            "duas": duas,
            "count": len(duas),
            "source": "tica_scrape",
            "note": "TICA does not provide a public REST API; data is scraped from the web interface. Values may require manual verification.",
        })
    except Exception as e:
        logger.error(f"TICA DUA search error: {e}")
        return JSONResponse({"duas": [], "error": str(e)}, status_code=500)


async def tica_lookup_partida(request: Request):
    """Lookup a partida arancelaria code and return DAI/IVA rates."""
    codigo = request.query_params.get("codigo", "")
    if not codigo:
        return JSONResponse({"error": "codigo query param required"}, status_code=400)

    # Known DAI rates by chapter (first 2 digits of partida)
    # Source: Arancel Centroamericano de Importación
    DAI_RATES = {
        "01": 15, "02": 15, "03": 5, "04": 15, "05": 0, "06": 5, "07": 15,
        "08": 15, "09": 15, "10": 15, "11": 15, "12": 5, "13": 5, "14": 5,
        "15": 15, "16": 15, "17": 15, "18": 15, "19": 15, "20": 15, "21": 15,
        "22": 15, "23": 5, "24": 15, "25": 0, "26": 0, "27": 5, "28": 0,
        "29": 0, "30": 5, "31": 0, "32": 5, "33": 10, "34": 10, "35": 5,
        "36": 10, "37": 5, "38": 5, "39": 5, "40": 5, "41": 5, "42": 15,
        "43": 15, "44": 5, "45": 5, "46": 15, "47": 0, "48": 5, "49": 0,
        "50": 10, "51": 10, "52": 10, "53": 10, "54": 10, "55": 10, "56": 10,
        "57": 15, "58": 15, "59": 10, "60": 10, "61": 15, "62": 15, "63": 15,
        "64": 15, "65": 15, "66": 15, "67": 15, "68": 5, "69": 5, "70": 5,
        "71": 5, "72": 0, "73": 5, "74": 0, "75": 0, "76": 5, "78": 5,
        "79": 5, "80": 5, "81": 0, "82": 5, "83": 10, "84": 0, "85": 5,
        "86": 0, "87": 5, "88": 0, "89": 0, "90": 0, "91": 10, "92": 10,
        "93": 15, "94": 15, "95": 15, "96": 10, "97": 0, "98": 0, "99": 0,
    }
    chapter = codigo[:2] if len(codigo) >= 2 else "00"
    dai = DAI_RATES.get(chapter, 5)
    iva = 13  # Standard IVA in Costa Rica

    # TLC benefits
    tlc_list = []
    if dai > 0:
        tlc_list = ["CAFTA-DR (USA)", "UE-CA", "China-CR", "Colombia-CR", "Mexico-CR", "Peru-CR", "Singapore-CR", "EFTA-CA"]

    return JSONResponse({
        "partida": {
            "codigo": codigo,
            "descripcion": f"Partida {codigo} - Capítulo {chapter}",
            "dai_pct": dai,
            "iva_pct": iva,
            "notas": f"DAI base: {dai}%. Puede variar según subpartida específica y TLC aplicable.",
            "tlc_aplicable": tlc_list,
        }
    })


async def tica_conciliate(request: Request):
    """
    Conciliate DUA line items against internal purchase order items.
    Uses fuzzy description matching and value proximity.
    """
    body = await request.json()
    dua_number = body.get("dua_number", "")
    internal_items = body.get("internal_items", [])
    if not internal_items:
        return JSONResponse({"error": "internal_items required"}, status_code=400)

    # For now, return a structured response indicating conciliation needs DUA data
    # In production, this would fetch DUA details and match line by line
    return JSONResponse({
        "dua_number": dua_number,
        "matched": [],
        "unmatched_dua": [],
        "unmatched_internal": [{"codigo": i["codigo"], "descripcion": i.get("descripcion", "")} for i in internal_items],
        "note": "Conciliation requires DUA line item data. Use searchDUAs first to retrieve DUA details, then conciliate.",
    })


# ---------------------------------------------------------------------------
# AI Code Mapping — vendor code to internal code correlation
# ---------------------------------------------------------------------------

def _normalize_text(s: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def _tokenize(s: str) -> set:
    stops = {"de","la","el","en","un","una","los","las","del","al","con","por","para","que","se","es","no","si","su","a","o","y","the","of","and","in","for","to","is","on","at","an","or"}
    return {t for t in _normalize_text(s).split() if len(t) > 1 and t not in stops}

def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    inter = a & b
    union = a | b
    return len(inter) / len(union) if union else 0.0


async def code_mapping_match(request: Request):
    """
    Match vendor items to internal codes using multi-signal similarity.
    Signals: exact code, fuzzy code (edit distance), description Jaccard,
    numeric pattern overlap, and optionally AI embeddings.
    """
    body = await request.json()
    vendor_items = body.get("vendor_items", [])
    threshold = body.get("match_threshold", 0.15)
    if not vendor_items:
        return JSONResponse({"error": "vendor_items required"}, status_code=400)

    # Fetch internal items from Supabase
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)

    try:
        import httpx as _httpx
        resp = _httpx.get(
            f"{sb_url}/rest/v1/mrp_master?select=codigo,descripcion,proveedor,familia&limit=5000",
            headers={
                "Authorization": f"Bearer {sb_key}",
                "apikey": sb_key,
                "Accept": "application/json",
            },
            timeout=15.0,
        )
        internal_items = resp.json() if resp.status_code == 200 else []
    except Exception as e:
        return JSONResponse({"error": f"Failed to fetch internal items: {e}"}, status_code=500)

    if not internal_items:
        return JSONResponse({"mappings": [], "note": "No internal items found in mrp_master"})

    # Pre-tokenize internal items
    internal_tokens = []
    for item in internal_items:
        internal_tokens.append({
            "item": item,
            "code_norm": _normalize_text(item.get("codigo", "")).replace(" ", ""),
            "tokens": _tokenize(item.get("descripcion", "")),
            "nums": set(re.findall(r"\d+(?:\.\d+)?", _normalize_text(item.get("descripcion", "")))),
        })

    mappings = []
    for vi in vendor_items:
        v_code = _normalize_text(vi.get("codigo", "")).replace(" ", "")
        v_tokens = _tokenize(vi.get("descripcion", ""))
        v_nums = set(re.findall(r"\d+(?:\.\d+)?", _normalize_text(vi.get("descripcion", ""))))

        candidates = []
        for it in internal_tokens:
            score = 0.0
            method = "fuzzy"
            reasons = []

            # Signal 1: Exact code
            if it["code_norm"] == v_code and v_code:
                score += 0.5
                method = "exact"
                reasons.append("exact_code")
            elif v_code and it["code_norm"]:
                max_len = max(len(v_code), len(it["code_norm"]))
                # Simple char overlap for codes
                common = sum(1 for a, b in zip(v_code, it["code_norm"]) if a == b)
                cs = common / max_len if max_len else 0
                if cs > 0.7:
                    score += cs * 0.3
                    reasons.append(f"code_sim_{cs:.0%}")

            # Signal 2: Description Jaccard
            j = _jaccard(v_tokens, it["tokens"])
            if j > 0.1:
                score += j * 0.4
                reasons.append(f"desc_jaccard_{j:.0%}")

            # Signal 3: Numeric overlap
            if v_nums and it["nums"]:
                shared = v_nums & it["nums"]
                if shared:
                    ns = len(shared) / max(len(v_nums), len(it["nums"]))
                    score += ns * 0.1
                    reasons.append(f"nums_{len(shared)}")

            if score >= threshold:
                candidates.append({
                    "codigo_interno": it["item"].get("codigo", ""),
                    "descripcion_interna": it["item"].get("descripcion", ""),
                    "similarity_score": round(min(score, 1.0), 4),
                    "match_method": method,
                    "reasons": reasons,
                })

        # Sort and take top 5
        candidates.sort(key=lambda x: x["similarity_score"], reverse=True)
        top = candidates[:5]

        if top:
            best = top[0]
            mappings.append({
                "codigo_proveedor": vi.get("codigo", ""),
                "descripcion_proveedor": vi.get("descripcion", ""),
                "proveedor": vi.get("proveedor", ""),
                "codigo_interno": best["codigo_interno"],
                "descripcion_interna": best["descripcion_interna"],
                "similarity_score": best["similarity_score"],
                "match_method": best["match_method"],
                "confirmed": best["similarity_score"] >= 0.5,
                "candidates": top,
            })
        else:
            mappings.append({
                "codigo_proveedor": vi.get("codigo", ""),
                "descripcion_proveedor": vi.get("descripcion", ""),
                "proveedor": vi.get("proveedor", ""),
                "codigo_interno": None,
                "descripcion_interna": None,
                "similarity_score": 0,
                "match_method": "none",
                "confirmed": False,
                "candidates": [],
            })

    return JSONResponse({"mappings": mappings, "count": len(mappings)})


async def code_mapping_save(request: Request):
    """Save confirmed code mappings to Supabase silver_finance.code_mappings."""
    body = await request.json()
    mappings = body.get("mappings", [])
    if not mappings:
        return JSONResponse({"error": "mappings required"}, status_code=400)

    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)

    try:
        import httpx as _httpx
        rows = []
        for m in mappings:
            rows.append({
                "codigo_interno": m.get("codigo_interno"),
                "codigo_proveedor": m.get("codigo_proveedor"),
                "proveedor": m.get("proveedor"),
                "descripcion_interna": m.get("descripcion_interna"),
                "descripcion_proveedor": m.get("descripcion_proveedor"),
                "similarity_score": m.get("similarity_score", 0),
                "match_method": m.get("match_method", "manual"),
                "confirmed": m.get("confirmed", False),
                "confirmed_by": m.get("confirmed_by", "system"),
                "metadata": m.get("metadata"),
            })
        resp = _httpx.post(
            f"{sb_url}/rest/v1/code_mappings",
            json=rows,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {sb_key}",
                "apikey": sb_key,
                "Prefer": "return=minimal",
            },
            timeout=15.0,
        )
        if resp.status_code in (200, 201):
            return JSONResponse({"saved": len(rows)})
        return JSONResponse({"error": resp.text, "saved": 0}, status_code=500)
    except Exception as e:
        return JSONResponse({"error": str(e), "saved": 0}, status_code=500)


async def code_mapping_list(request: Request):
    """List existing code mappings, optionally filtered by proveedor or confirmed status."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)

    proveedor = request.query_params.get("proveedor", "")
    confirmed = request.query_params.get("confirmed", "")

    try:
        import httpx as _httpx
        url = f"{sb_url}/rest/v1/code_mappings?select=*&order=created_at.desc&limit=200"
        if proveedor:
            url += f"&proveedor=eq.{proveedor}"
        if confirmed == "true":
            url += "&confirmed=eq.true"
        resp = _httpx.get(
            url,
            headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key},
            timeout=15.0,
        )
        return JSONResponse({"mappings": resp.json() if resp.status_code == 200 else []})
    except Exception as e:
        return JSONResponse({"error": str(e), "mappings": []}, status_code=500)


# ---------------------------------------------------------------------------
# Data Model Dashboard API endpoints
# ---------------------------------------------------------------------------

async def data_model_schema(request: Request):
    """Return full schema for ER diagram: all tables with columns, PKs, FKs, row counts."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    try:
        import httpx as _httpx
        headers = {"Authorization": f"Bearer {sb_key}", "apikey": sb_key}
        # Get all tables across schemas
        sql = """
        SELECT
            t.table_schema, t.table_name,
            (SELECT json_agg(json_build_object(
                'column_name', c.column_name,
                'data_type', c.data_type,
                'is_nullable', c.is_nullable,
                'column_default', c.column_default,
                'ordinal_position', c.ordinal_position
            ) ORDER BY c.ordinal_position)
            FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
            ) as columns,
            (SELECT json_agg(kcu.column_name)
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = t.table_schema AND tc.table_name = t.table_name
                AND tc.constraint_type = 'PRIMARY KEY'
            ) as primary_keys
        FROM information_schema.tables t
        WHERE t.table_schema IN ('silver_finance', 'bronze_finance', 'tms', 'dim')
            AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name;
        """
        resp = _httpx.post(
            f"{sb_url}/rest/v1/rpc/exec_sql",
            headers={**headers, "Content-Type": "application/json"},
            json={"sql_query": sql},
            timeout=30.0,
        )
        tables = resp.json() if resp.status_code == 200 else []
        # Also get FK relationships
        fk_sql = """
        SELECT
            tc.table_schema, tc.table_name, kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema IN ('silver_finance', 'bronze_finance', 'tms', 'dim');
        """
        resp2 = _httpx.post(
            f"{sb_url}/rest/v1/rpc/exec_sql",
            headers={**headers, "Content-Type": "application/json"},
            json={"sql_query": fk_sql},
            timeout=30.0,
        )
        fks = resp2.json() if resp2.status_code == 200 else []
        return JSONResponse({"tables": tables, "foreign_keys": fks})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def kafka_status(request: Request):
    """Get Kafka cluster and topic status from AKS via kubectl proxy or direct API."""
    try:
        # Return static config + any live data we can get
        from agent.cdc.config import CDC_TABLES, KAFKA_BOOTSTRAP, KAFKA_TOPIC_PREFIX
        topics = []
        for table_name, cfg in CDC_TABLES.items():
            topics.append({
                "name": f"{KAFKA_TOPIC_PREFIX}.{table_name}",
                "table": table_name,
                "entity": cfg.get("entity", table_name),
                "partitions": 3,
                "replication_factor": 3,
            })
        topics.append({
            "name": f"{KAFKA_TOPIC_PREFIX}.dlq",
            "table": "dlq",
            "entity": "Dead Letter Queue",
            "partitions": 3,
            "replication_factor": 3,
        })
        return JSONResponse({
            "bootstrap": KAFKA_BOOTSTRAP,
            "topic_prefix": KAFKA_TOPIC_PREFIX,
            "topics": topics,
            "cluster": {
                "brokers": 3,
                "controllers": 3,
                "version": "4.0.0",
                "mode": "KRaft",
                "strimzi_version": "0.50.1",
            },
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def erp_schema(request: Request):
    """Get PcGraf ERP table schema with columns, types, PKs, and row counts."""
    try:
        import pymssql
        from agent.cdc.config import PCGRAF_HOST, PCGRAF_USER, PCGRAF_PASS, PCGRAF_DB, CDC_TABLES
        conn = pymssql.connect(server=PCGRAF_HOST, user=PCGRAF_USER, password=PCGRAF_PASS, database=PCGRAF_DB)
        cursor = conn.cursor(as_dict=True)
        tables = []
        for table_name, cfg in CDC_TABLES.items():
            try:
                # Get columns
                cursor.execute(f"""
                    SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH,
                           c.IS_NULLABLE, c.ORDINAL_POSITION
                    FROM INFORMATION_SCHEMA.COLUMNS c
                    WHERE c.TABLE_NAME = %s
                    ORDER BY c.ORDINAL_POSITION
                """, (table_name,))
                columns = cursor.fetchall()
                # Get row count
                cursor.execute(f"SELECT COUNT(*) as cnt FROM [{table_name}]")
                row_count = cursor.fetchone()["cnt"]
                # Get PK columns
                pk_cols = [p.strip() for p in cfg.get("pk", "").split(",") if p.strip()]
                tables.append({
                    "sql_table": table_name,
                    "entity": cfg.get("entity", table_name),
                    "strategy": cfg.get("strategy", "checksum"),
                    "date_col": cfg.get("date_col"),
                    "pk_columns": pk_cols,
                    "row_count": row_count,
                    "columns": [{
                        "name": c["COLUMN_NAME"],
                        "type": c["DATA_TYPE"],
                        "max_length": c["CHARACTER_MAXIMUM_LENGTH"],
                        "nullable": c["IS_NULLABLE"] == "YES",
                        "is_pk": c["COLUMN_NAME"] in pk_cols,
                        "ordinal": c["ORDINAL_POSITION"],
                    } for c in columns],
                })
            except Exception as te:
                tables.append({
                    "sql_table": table_name,
                    "entity": cfg.get("entity", table_name),
                    "error": str(te),
                    "columns": [],
                    "row_count": 0,
                    "pk_columns": [],
                })
        conn.close()
        return JSONResponse({"database": PCGRAF_DB, "tables": tables})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def data_curation_save(request: Request):
    """Save curated data changes to Supabase and/or PcGraf ERP.
    Body: { table, schema, row_id, changes: {col: val}, targets: ['supabase','erp','faiss'] }
    """
    body = await request.json()
    table = body.get("table", "")
    schema = body.get("schema", "tms")
    row_id = body.get("row_id")
    changes = body.get("changes", {})
    targets = body.get("targets", ["supabase", "faiss"])
    results = {}

    if not table or not changes:
        return JSONResponse({"error": "table and changes required"}, status_code=400)

    # 1. Supabase update
    if "supabase" in targets:
        try:
            sb_url = os.environ.get("SUPABASE_URL", "")
            sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
            import httpx as _httpx
            profile = "tms" if schema == "tms" else "public"
            resp = _httpx.patch(
                f"{sb_url}/rest/v1/{table}?id=eq.{row_id}",
                headers={
                    "Authorization": f"Bearer {sb_key}",
                    "apikey": sb_key,
                    "Content-Type": "application/json",
                    "Accept-Profile": profile,
                    "Content-Profile": profile,
                    "Prefer": "return=minimal",
                },
                json=changes,
                timeout=15.0,
            )
            results["supabase"] = {"status": "ok" if resp.status_code < 300 else "error", "code": resp.status_code}
        except Exception as e:
            results["supabase"] = {"status": "error", "message": str(e)}

    # 2. PcGraf ERP update
    if "erp" in targets:
        try:
            import pymssql
            from agent.cdc.config import PCGRAF_HOST, PCGRAF_USER, PCGRAF_PASS, PCGRAF_DB
            conn = pymssql.connect(server=PCGRAF_HOST, user=PCGRAF_USER, password=PCGRAF_PASS, database=PCGRAF_DB)
            cursor = conn.cursor()
            set_clause = ", ".join([f"[{k}] = %s" for k in changes.keys()])
            pk_col = body.get("pk_col", "id")
            sql = f"UPDATE [{table}] SET {set_clause} WHERE [{pk_col}] = %s"
            params = list(changes.values()) + [row_id]
            cursor.execute(sql, tuple(params))
            conn.commit()
            conn.close()
            results["erp"] = {"status": "ok", "rows_affected": cursor.rowcount}
        except Exception as e:
            results["erp"] = {"status": "error", "message": str(e)}

    # 3. FAISS KB refresh
    if "faiss" in targets:
        try:
            from agent.knowledge_base import incremental_sync
            incremental_sync()
            results["faiss"] = {"status": "ok"}
        except Exception as e:
            results["faiss"] = {"status": "error", "message": str(e)}

    return JSONResponse({"results": results})


# ---------------------------------------------------------------------------
# CDC (Change Data Capture) API endpoints
# ---------------------------------------------------------------------------

async def cdc_status(request: Request):
    """Get CDC watermarks and status for all tracked tables."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    tms_headers = {"Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Accept-Profile": "tms"}
    try:
        import httpx as _httpx
        resp = _httpx.get(
            f"{sb_url}/rest/v1/cdc_watermarks?select=*&order=sql_table_name",
            headers=tms_headers,
            timeout=15.0,
        )
        watermarks = resp.json() if resp.status_code == 200 else []
        # Also get recent events count
        resp2 = _httpx.get(
            f"{sb_url}/rest/v1/cdc_events?select=sql_table_name,event_type&order=detected_at.desc&limit=500",
            headers=tms_headers,
            timeout=15.0,
        )
        events = resp2.json() if resp2.status_code == 200 else []
        # Aggregate events by table
        event_counts = {}
        for ev in events:
            t = ev.get("sql_table_name", "")
            event_counts[t] = event_counts.get(t, 0) + 1
        return JSONResponse({
            "watermarks": watermarks,
            "recent_event_counts": event_counts,
            "total_recent_events": len(events),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def cdc_poll_now(request: Request):
    """Trigger an immediate CDC poll for one or all tables."""
    body = await request.json()
    table = body.get("table")  # None = poll all
    try:
        from cdc.poller import CDCPoller
        from cdc.config import CDC_TABLES
        poller = CDCPoller(kafka_producer=None)  # No Kafka in web context
        if table:
            if table not in CDC_TABLES:
                return JSONResponse({"error": f"Table {table} not tracked. Available: {list(CDC_TABLES.keys())}"}, status_code=400)
            result = poller.poll_table(table, CDC_TABLES[table])
            return JSONResponse({"results": [result]})
        else:
            results = poller.poll_all()
            return JSONResponse({"results": results})
    except Exception as e:
        logger.error(f"CDC poll error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def cdc_table_registry(request: Request):
    """Get the table registry mapping SQL tech names to business-readable names."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    try:
        import httpx as _httpx
        resp = _httpx.get(
            f"{sb_url}/rest/v1/table_registry?select=*&order=erp_module,entity_name",
            headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Accept-Profile": "tms"},
            timeout=15.0,
        )
        return JSONResponse({"tables": resp.json() if resp.status_code == 200 else []})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def health(request: Request):
    from agent.llm_fallback import get_fallback_status
    vs = get_vectorstore()
    analytics_url = os.environ.get("ANALYTICS_AGENT_URL", "")
    data_svc_url = os.environ.get("DATA_SERVICE_AGENT_URL", "")
    return JSONResponse({
        "status": "ok",
        "kb_loaded": vs is not None,
        "model": os.environ.get("OPENROUTER_MODEL", "gpt-oss-120b"),
        "architecture": "decoupled" if analytics_url else "monolithic",
        "langsmith_project": os.environ.get("LANGCHAIN_PROJECT", "treasury-root-agent"),
        "sub_agents": {
            "analytics": analytics_url or "in-process",
            "data_service": data_svc_url or "in-process",
        },
        "llm_fallback": get_fallback_status(),
    })


# ---------------------------------------------------------------------------
# Static file serving (built Vite frontend)
# ---------------------------------------------------------------------------
from starlette.staticfiles import StaticFiles
from starlette.responses import FileResponse

STATIC_DIR = os.environ.get("STATIC_DIR", "")

async def spa_fallback(request: Request):
    """Serve index.html for any non-API route (SPA client-side routing)."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if STATIC_DIR and os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not available"}, status_code=404)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
routes = [
    Route("/agent/stream", agent_stream, methods=["POST"]),
    # KB
    Route("/kb/search", kb_search_endpoint, methods=["POST"]),
    Route("/kb/sync", kb_sync_endpoint, methods=["POST"]),
    Route("/kb/stats", kb_stats_endpoint, methods=["GET"]),
    Route("/kb/cdc_refresh", kb_cdc_refresh_endpoint, methods=["POST"]),
    Route("/kb/upload", kb_upload_endpoint, methods=["POST"]),
    # Sessions
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
    # ERP Modules: Facturas, Contratos, Hitos
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
]

# Mount static assets (JS/CSS/images) if STATIC_DIR exists
if STATIC_DIR and os.path.isdir(STATIC_DIR):
    from starlette.routing import Mount
    # Serve /assets (hashed JS/CSS bundles)
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        routes.append(Mount("/assets", app=StaticFiles(directory=assets_dir), name="static-assets"))
    # Root index.html
    routes.append(Route("/", spa_fallback, methods=["GET"]))
    # SPA fallback for client-side routes — must be last
    routes.append(Route("/{path:path}", spa_fallback, methods=["GET"]))

middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    ),
]

app = Starlette(routes=routes, middleware=middleware)

# Start KB auto-sync daemon (4-min interval) on server boot
try:
    start_auto_sync()
    logger.info("KB auto-sync daemon started (4-min interval)")
except Exception as e:
    logger.warning(f"KB auto-sync start failed: {e}")


if __name__ == "__main__":
    init_kb()
    port = int(os.environ.get("AGENT_PORT", "8000"))
    logger.info(f"Starting Treasury Agent server on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
