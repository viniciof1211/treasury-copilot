"""Local development server — runs the same AG-UI streaming endpoint locally (no Modal)."""

import os
import sys
import json
import uuid
import logging
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
)
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

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
    count = sync_from_supabase()
    return JSONResponse({"synced_chunks": count})


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


async def health(request: Request):
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


if __name__ == "__main__":
    init_kb()
    port = int(os.environ.get("AGENT_PORT", "8000"))
    logger.info(f"Starting Treasury Agent server on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
