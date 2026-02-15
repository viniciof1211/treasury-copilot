"""Data Service Agent — connects to Supabase and other DBs, provides structured data.

This agent is a sub-agent called by the Treasury root agent when it needs
structured data from databases. It returns clean JSON/tabular results.
"""

import os
import json
import logging
import httpx
from typing import Optional
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing import Annotated, TypedDict, Sequence

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

DATA_SERVICE_PROMPT = """Eres el Data Service Agent — un agente especializado en conectar a bases de datos,
extraer datos estructurados, y devolverlos en formato limpio (JSON, tablas).

Tu trabajo:
1. Recibir solicitudes de datos del Treasury Agent o Analytics Agent.
2. Ejecutar queries SQL contra Supabase (schemas: bronze_finance, silver_finance, dim).
3. Devolver datos estructurados en formato JSON con metadata (tabla, columnas, tipos, conteo).
4. NUNCA inventar datos. Si una tabla no existe o la query falla, reportar el error.

Tablas disponibles en Supabase:
- silver_finance.cxp_items — Cuentas por pagar (proveedor, monto_usd, vencimiento_fecha, prioridad, empresa, negocio)
- silver_finance.flujo_semanal — Operaciones bancarias (compania, cuota, principal, intereses, vencimiento)
- silver_finance.cxc_items — Cuentas por cobrar (cliente, monto, aging, gestor_cobro, area_comercial)
- silver_finance.mrp_master — Planning de compras/MRP (SKU, inventario, alertas)
- silver_finance.projection_12m — Proyección mensual (projected_inflows, projected_outflows, projected_balance)
- bronze_finance.ingest_runs — Historial de ingestas
- dim.business_units — Unidades de negocio
- dim.allocation_rules — Reglas de distribución

Formato de respuesta:
Siempre devuelve JSON estructurado con:
{
  "table": "nombre_tabla",
  "columns": ["col1", "col2"],
  "row_count": N,
  "rows": [...],
  "query_used": "SELECT ..."
}
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _call_edge_function(tool_name: str, params: dict) -> dict:
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
def db_query(sql: str) -> str:
    """Execute a read-only SELECT query on Supabase Postgres.
    Schemas: bronze_finance, silver_finance, dim.
    Always use schema-qualified names like silver_finance.cxp_items.
    Returns structured JSON with rows, columns, and metadata."""
    result = _call_edge_function("query_sql", {"sql": sql})
    rows = result.get("rows", [])
    if result.get("error"):
        return json.dumps({"error": result["error"], "rows": [], "row_count": 0})

    columns = list(rows[0].keys()) if rows else []
    return json.dumps({
        "rows": rows,
        "columns": columns,
        "row_count": len(rows),
        "query_used": sql,
    })


@tool
def db_list_tables() -> str:
    """List all available tables and their schemas in the database.
    Returns table names, schemas, and approximate row counts."""
    tables = [
        {"schema": "silver_finance", "table": "cxp_items", "description": "Cuentas por pagar"},
        {"schema": "silver_finance", "table": "flujo_semanal", "description": "Operaciones bancarias"},
        {"schema": "silver_finance", "table": "cxc_items", "description": "Cuentas por cobrar"},
        {"schema": "silver_finance", "table": "mrp_master", "description": "Planning de compras/MRP"},
        {"schema": "silver_finance", "table": "projection_12m", "description": "Proyección mensual 12M"},
        {"schema": "bronze_finance", "table": "ingest_runs", "description": "Historial de ingestas"},
        {"schema": "dim", "table": "business_units", "description": "Unidades de negocio"},
        {"schema": "dim", "table": "allocation_rules", "description": "Reglas de distribución"},
    ]
    # Get row counts
    for t in tables:
        try:
            result = _call_edge_function("query_sql", {
                "sql": f"SELECT COUNT(*) as cnt FROM {t['schema']}.{t['table']}"
            })
            rows = result.get("rows", [])
            t["row_count"] = rows[0]["cnt"] if rows else 0
        except Exception:
            t["row_count"] = "unknown"
    return json.dumps({"tables": tables})


@tool
def db_describe_table(table_name: str) -> str:
    """Get column names, types, and sample data for a specific table.
    table_name should be schema-qualified, e.g. 'silver_finance.cxp_items'."""
    # Get column info via a sample query
    result = _call_edge_function("query_sql", {
        "sql": f"SELECT * FROM {table_name} LIMIT 3"
    })
    rows = result.get("rows", [])
    if result.get("error"):
        return json.dumps({"error": result["error"]})

    columns = list(rows[0].keys()) if rows else []
    # Infer types from sample
    col_info = []
    for col in columns:
        sample_vals = [str(r.get(col, "")) for r in rows if r.get(col) is not None]
        col_info.append({
            "name": col,
            "sample_values": sample_vals[:3],
        })

    return json.dumps({
        "table": table_name,
        "columns": col_info,
        "sample_row_count": len(rows),
    })


@tool
def db_aggregate(table_name: str, group_by: str, metrics: str) -> str:
    """Run an aggregation query on a table.
    table_name: schema-qualified table name (e.g. 'silver_finance.cxp_items')
    group_by: comma-separated columns to group by (e.g. 'empresa,negocio')
    metrics: comma-separated aggregations (e.g. 'SUM(monto_usd) as total_usd, COUNT(*) as cnt')
    Returns aggregated results as structured JSON."""
    sql = f"SELECT {group_by}, {metrics} FROM {table_name} GROUP BY {group_by} ORDER BY {group_by}"
    result = _call_edge_function("query_sql", {"sql": sql})
    rows = result.get("rows", [])
    if result.get("error"):
        return json.dumps({"error": result["error"], "rows": []})
    columns = list(rows[0].keys()) if rows else []
    return json.dumps({
        "rows": rows,
        "columns": columns,
        "row_count": len(rows),
        "query_used": sql,
    })


@tool
def db_ingest_excel(file_id: str = "latest") -> str:
    """Ingest an Excel file from Supabase Storage into the database.
    file_id: storage path or 'latest' for most recent XLSX."""
    result = _call_edge_function("ingest_excel", {"file_id": file_id})
    return json.dumps(result)


@tool
def db_recalc_projection() -> str:
    """Recalculate the 12-month cashflow projection from current data.
    Updates silver_finance.projection_12m."""
    result = _call_edge_function("recalc_projection", {})
    return json.dumps(result)


DATA_SERVICE_TOOLS = [
    db_query,
    db_list_tables,
    db_describe_table,
    db_aggregate,
    db_ingest_excel,
    db_recalc_projection,
]


# ---------------------------------------------------------------------------
# State & Graph
# ---------------------------------------------------------------------------

class DataServiceState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]


def create_data_service_graph():
    """Create the Data Service Agent graph."""
    llm = ChatOpenAI(
        model=os.environ.get("OPENROUTER_MODEL", "gpt-oss-120b"),
        openai_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openai_api_base="https://openrouter.ai/api/v1",
        temperature=0.0,
        max_tokens=4096,
        streaming=True,
    )
    llm_with_tools = llm.bind_tools(DATA_SERVICE_TOOLS)

    def should_continue(state: DataServiceState) -> str:
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        return END

    def call_model(state: DataServiceState) -> dict:
        messages = list(state["messages"])
        if not messages or not isinstance(messages[0], SystemMessage):
            messages.insert(0, SystemMessage(content=DATA_SERVICE_PROMPT))
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(DATA_SERVICE_TOOLS)
    workflow = StateGraph(DataServiceState)
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", tool_node)
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_edge("tools", "agent")

    return workflow.compile()


_data_service_graph = None

def get_data_service_graph():
    global _data_service_graph
    if _data_service_graph is None:
        _data_service_graph = create_data_service_graph()
    return _data_service_graph
