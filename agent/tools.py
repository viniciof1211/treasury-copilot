"""Treasury tools for the LangGraph agent — mirrors the Supabase Edge Function tools."""

import os
import json
import httpx
from langchain_core.tools import tool
from typing import Optional


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _call_edge_function(tool_name: str, params: dict) -> dict:
    """Call the existing Supabase Edge Function treasury-tools endpoint."""
    url = f"{SUPABASE_URL}/functions/v1/treasury-tools"
    resp = httpx.post(
        url,
        json={"tool": tool_name, "params": params},
        headers=_supabase_headers(),
        timeout=60.0,
    )
    if resp.status_code != 200:
        return {"error": f"Edge Function error: {resp.status_code} {resp.text[:500]}"}
    return resp.json()


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def query_sql(sql: str) -> str:
    """Execute a read-only SELECT query on bronze_finance, silver_finance, or dim schemas.
    Tables: cxp_items, flujo_semanal, projection_12m, mrp_master, cxc_items, ingest_runs, business_units, allocation_rules.
    Always use schema-qualified names like silver_finance.cxp_items.
    Never invent data — only use results from this tool."""
    result = _call_edge_function("query_sql", {"sql": sql})
    rows = result.get("rows", [])
    if result.get("error"):
        return json.dumps({"error": result["error"], "rows": []})
    return json.dumps({"rows": rows, "count": len(rows)})


@tool
def ingest_excel(file_id: str = "latest") -> str:
    """Process an Excel file from Supabase Storage (treasury-files bucket).
    Use file_id path or 'latest' for most recent XLSX.
    Returns ingest_run_id for trazabilidad."""
    result = _call_edge_function("ingest_excel", {"file_id": file_id})
    return json.dumps(result)


@tool
def recalc_projection() -> str:
    """Recalculate 12-month cashflow projection from Flujo Semanal and CxP data.
    Applies 25% allocation per BU. Updates silver_finance.projection_12m."""
    result = _call_edge_function("recalc_projection", {})
    return json.dumps(result)


@tool
def web_search(query: str, search_depth: str = "basic", include_domains: Optional[str] = None) -> str:
    """Search the web for real-time information: exchange rates (CRC/USD), tax rules (IVA, cargas sociales, DUA),
    bank interest rates, Hacienda regulations, import costs, CCSS rates, fiscal calendar.
    Returns AI-summarized answer plus source URLs.
    include_domains: comma-separated, e.g. 'hacienda.go.cr,bccr.fi.cr,ccss.sa.cr'"""
    params: dict = {"query": query, "search_depth": search_depth}
    if include_domains:
        params["include_domains"] = [d.strip() for d in include_domains.split(",")]
    result = _call_edge_function("web_search", params)
    return json.dumps(result)


@tool
def get_cr_indicators(indicator: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> str:
    """Get official Costa Rican economic indicators from BCCR (Banco Central).
    indicator: 'tipo_cambio' (USD/CRC buy+sell), 'tasa_basica', 'ipc', 'tpm', or numeric BCCR code.
    Dates in DD/MM/YYYY format. ALWAYS prefer this over web_search for exchange rates."""
    params: dict = {"indicator": indicator}
    if date_from:
        params["date_from"] = date_from
    if date_to:
        params["date_to"] = date_to
    result = _call_edge_function("get_cr_indicators", params)
    return json.dumps(result)


@tool
def search_treasury_kb(query: str) -> str:
    """Search the Treasury Knowledge Base (FAISS) for information from ingested Excel files,
    process documentation, and financial reference data. Use this to find specific data points,
    business rules, or historical financial information that may not be in the SQL tables."""
    # This will be implemented to call the FAISS KB on Modal
    # For now, it delegates to the kb module
    from agent.knowledge_base import search_kb
    results = search_kb(query, k=5)
    return json.dumps({"results": results, "query": query})


# ---------------------------------------------------------------------------
# Sub-agent delegation tools (HTTP calls to separate Modal/Azure microservices)
# ---------------------------------------------------------------------------

# Sub-agent URLs — set via env vars; fallback to in-process for local dev
ANALYTICS_AGENT_URL = os.environ.get("ANALYTICS_AGENT_URL", "")
DATA_SERVICE_AGENT_URL = os.environ.get("DATA_SERVICE_AGENT_URL", "")


def _call_sub_agent_http(url: str, payload: dict, timeout: float = 120.0) -> dict:
    """Call a sub-agent via HTTP POST to its /invoke endpoint."""
    resp = httpx.post(f"{url}/invoke", json=payload, timeout=timeout)
    if resp.status_code != 200:
        return {"content": f"Sub-agent error: {resp.status_code} {resp.text[:500]}", "images": []}
    return resp.json()


@tool
def call_data_service(request: str) -> str:
    """Delegate a data retrieval task to the Data Service Agent.
    Use this when you need structured data from databases — complex queries,
    aggregations, table descriptions, or multi-step data extraction.
    The Data Service Agent has specialized tools for Supabase DB operations.
    request: Natural language description of what data you need."""
    if DATA_SERVICE_AGENT_URL:
        result = _call_sub_agent_http(DATA_SERVICE_AGENT_URL, {"request": request})
        return result.get("content", json.dumps(result))[:8000]
    # Fallback: in-process (local dev)
    from agent.data_service_agent import get_data_service_graph
    from langchain_core.messages import HumanMessage
    graph = get_data_service_graph()
    result = graph.invoke({"messages": [HumanMessage(content=request)]})
    last_msg = result["messages"][-1]
    content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
    return content[:8000]


@tool
def call_analytics_agent(request: str, data_json: str = "{}") -> str:
    """Delegate a data analysis or charting task to the Analytics Agent.
    Use this when you need:
    - Charts/plots (bar, line, pie, waterfall, heatmap, scatter, area)
    - Statistical analysis (mean, median, std, correlations)
    - Python-based heavy-duty data analysis
    - Visual reports with professional ARA Group branding

    request: Natural language description of the analysis/chart needed.
    data_json: JSON string with the data to analyze (from query_sql or call_data_service).

    Returns: JSON with analysis results and base64-encoded PNG images.
    The images field contains base64 strings that the frontend renders as <img> tags."""
    if ANALYTICS_AGENT_URL:
        result = _call_sub_agent_http(
            ANALYTICS_AGENT_URL,
            {"request": request, "data_json": data_json},
            timeout=180.0,
        )
        # Re-pack: keep images for SSE extraction but truncate content to avoid
        # blowing up the LLM context (images are ~50KB+ base64 each).
        images = result.get("images", [])
        content = result.get("content", "")[:3000]
        if images:
            return json.dumps({
                "content": content,
                "images": images,
                "success": True,
                "chart_count": len(images),
            })
        return content
    # Fallback: in-process (local dev)
    from agent.analytics_agent import get_analytics_graph
    from langchain_core.messages import HumanMessage
    full_request = request
    if data_json and data_json != "{}":
        full_request += f"\n\nDatos disponibles (JSON):\n```json\n{data_json[:10000]}\n```"
    graph = get_analytics_graph()
    result = graph.invoke({"messages": [HumanMessage(content=full_request)]})
    last_msg = result["messages"][-1]
    content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
    return content[:15000]


# All tools list for the agent
ALL_TOOLS = [
    query_sql,
    ingest_excel,
    recalc_projection,
    web_search,
    get_cr_indicators,
    search_treasury_kb,
    call_data_service,
    call_analytics_agent,
]
