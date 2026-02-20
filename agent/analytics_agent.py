"""Data Analytics Agent — expert in charting, plotting, and heavy-duty Python analysis.

This agent receives structured data from the Data Service Agent and produces:
- Python-generated charts (matplotlib/seaborn) saved as base64 PNG images
- Statistical analysis, trend detection, anomaly detection
- Formatted analysis reports with embedded visualizations

Charts are returned as base64-encoded PNG strings that the frontend renders inline.
"""

import os
import io
import json
import base64
import logging
import traceback
from typing import Annotated, TypedDict, Sequence

from langchain_core.tools import tool
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from agent.llm_fallback import create_fallback_llm_with_tools

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

ANALYTICS_PROMPT = """Eres el Data Analytics Agent — un experto en análisis de datos financieros,
visualización con Python (matplotlib, seaborn, pandas), y generación de reportes ejecutivos.

Tu trabajo:
1. Recibir datos estructurados (JSON/tablas) del Data Service Agent o del Treasury Agent.
2. Ejecutar análisis Python: estadísticas, tendencias, anomalías, proyecciones, correlaciones.
3. Generar gráficos profesionales con la paleta ARA Group:
   - Verde principal: #1A4A28
   - Verde claro: #2D7A4A
   - Dorado: #C5A55A
   - Gris oscuro: #333333
   - Gris claro: #F5F5F5
   - Blanco: #FFFFFF
4. Devolver gráficos como imágenes base64 PNG que el frontend puede renderizar.
5. Siempre incluir un resumen ejecutivo con los hallazgos clave.

Tipos de gráficos que puedes generar:
- Barras (horizontales/verticales) para comparaciones
- Líneas para tendencias temporales
- Waterfall para flujos de caja
- Pie/donut para distribuciones
- Heatmap para matrices de correlación
- Scatter para relaciones entre variables
- Stacked bars para composición
- Area charts para volúmenes acumulados

Reglas:
- Siempre usar la paleta ARA Group.
- Títulos en español.
- Formato de moneda: $1,234,567 (USD) o ₡1.234.567 (CRC).
- Gráficos de alta resolución (150 DPI, figsize mínimo 10x6).
- Incluir leyendas, etiquetas de ejes, y títulos descriptivos.
- Si los datos son insuficientes para un gráfico, explicar por qué y sugerir qué datos se necesitan.

Herramientas:
- execute_python_analysis: ejecuta código Python con pandas/matplotlib/seaborn y devuelve resultados + gráficos.
- generate_chart: genera un gráfico específico a partir de datos JSON.
- compute_statistics: calcula estadísticas descriptivas de un dataset.
"""

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def _safe_exec_python(code: str, data_json: str = "{}") -> dict:
    """Execute Python code safely and capture output + generated images."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import pandas as pd
    import numpy as np

    # Set ARA Group style
    plt.rcParams.update({
        'figure.facecolor': '#FFFFFF',
        'axes.facecolor': '#F5F5F5',
        'axes.edgecolor': '#333333',
        'axes.labelcolor': '#333333',
        'text.color': '#333333',
        'xtick.color': '#333333',
        'ytick.color': '#333333',
        'font.size': 11,
        'axes.titlesize': 14,
        'axes.labelsize': 12,
        'figure.dpi': 150,
        'figure.figsize': (10, 6),
    })

    ARA_COLORS = ['#1A4A28', '#2D7A4A', '#C5A55A', '#333333', '#6B8F71', '#8B7355', '#4A7C59', '#D4A853']

    # Parse input data
    try:
        data = json.loads(data_json) if isinstance(data_json, str) else data_json
    except Exception:
        data = {}

    # Prepare execution namespace
    namespace = {
        'pd': pd,
        'np': np,
        'plt': plt,
        'json': json,
        'io': io,
        'base64': base64,
        'data': data,
        'ARA_COLORS': ARA_COLORS,
        'images': [],
        'results': {},
    }

    output_lines = []
    images = []

    try:
        # Capture print output
        from io import StringIO
        import sys
        old_stdout = sys.stdout
        sys.stdout = StringIO()

        exec(code, namespace)

        printed = sys.stdout.getvalue()
        sys.stdout = old_stdout
        if printed:
            output_lines.append(printed)

        # Capture any open matplotlib figures
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight', dpi=150, facecolor='white')
            buf.seek(0)
            img_b64 = base64.b64encode(buf.read()).decode('utf-8')
            images.append(img_b64)
            buf.close()
        plt.close('all')

        # Also capture images from namespace
        if namespace.get('images'):
            images.extend(namespace['images'])

        results = namespace.get('results', {})
        if isinstance(results, pd.DataFrame):
            results = results.to_dict(orient='records')

        return {
            "success": True,
            "output": "\n".join(output_lines),
            "images": images,
            "results": results if isinstance(results, (dict, list)) else str(results),
        }

    except Exception as e:
        try:
            sys.stdout = old_stdout
        except Exception:
            pass
        plt.close('all')
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "images": [],
            "results": {},
        }


@tool
def execute_python_analysis(code: str, data_json: str = "{}") -> str:
    """Execute Python code for data analysis and chart generation.

    Args:
        code: Python code to execute. Has access to: pd (pandas), np (numpy),
              plt (matplotlib.pyplot), data (parsed JSON input), ARA_COLORS (brand palette).
              Store results in 'results' dict. Charts are auto-captured from plt figures.
        data_json: JSON string with input data (e.g. query results from Data Service Agent).

    Returns: JSON with success status, output text, base64 images, and results dict.
    """
    result = _safe_exec_python(code, data_json)
    # Truncate large results
    result_str = json.dumps(result)
    if len(result_str) > 50000:
        result["results"] = {"truncated": True, "message": "Results too large, showing summary only"}
        result["output"] = result.get("output", "")[:5000]
        result_str = json.dumps(result)
    return result_str


@tool
def generate_chart(
    chart_type: str,
    data_json: str,
    title: str = "Gráfico",
    x_label: str = "",
    y_label: str = "",
    x_column: str = "",
    y_columns: str = "",
    group_by: str = "",
) -> str:
    """Generate a specific chart type from structured data.

    Args:
        chart_type: bar, hbar, line, pie, donut, waterfall, scatter, area, stacked_bar, heatmap
        data_json: JSON string with rows of data
        title: Chart title (Spanish)
        x_label: X-axis label
        y_label: Y-axis label
        x_column: Column name for X axis
        y_columns: Comma-separated column names for Y values
        group_by: Optional column to group/color by

    Returns: JSON with base64 PNG image and metadata.
    """
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    import pandas as pd
    import numpy as np

    ARA = ['#1A4A28', '#2D7A4A', '#C5A55A', '#333333', '#6B8F71', '#8B7355', '#4A7C59', '#D4A853']

    try:
        data = json.loads(data_json) if isinstance(data_json, str) else data_json
        rows = data.get("rows", data) if isinstance(data, dict) else data
        df = pd.DataFrame(rows)
    except Exception as e:
        return json.dumps({"error": f"Cannot parse data: {e}", "images": []})

    if df.empty:
        return json.dumps({"error": "No data to chart", "images": []})

    y_cols = [c.strip() for c in y_columns.split(",") if c.strip()] if y_columns else []

    fig, ax = plt.subplots(figsize=(10, 6))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('#F5F5F5')

    try:
        if chart_type == "bar":
            if x_column and y_cols:
                df.plot.bar(x=x_column, y=y_cols, ax=ax, color=ARA[:len(y_cols)], edgecolor='white')
            else:
                df.plot.bar(ax=ax, color=ARA[0], edgecolor='white')
            plt.xticks(rotation=45, ha='right')

        elif chart_type == "hbar":
            if x_column and y_cols:
                df.plot.barh(x=x_column, y=y_cols, ax=ax, color=ARA[:len(y_cols)], edgecolor='white')
            else:
                df.plot.barh(ax=ax, color=ARA[0], edgecolor='white')

        elif chart_type == "line":
            if x_column and y_cols:
                for i, col in enumerate(y_cols):
                    ax.plot(df[x_column], df[col], color=ARA[i % len(ARA)], linewidth=2, marker='o', markersize=4, label=col)
                ax.legend()
            else:
                df.plot.line(ax=ax, color=ARA[0], linewidth=2)

        elif chart_type == "pie":
            col = y_cols[0] if y_cols else df.columns[-1]
            labels = df[x_column].tolist() if x_column else df.index.tolist()
            ax.pie(df[col], labels=labels, colors=ARA[:len(df)], autopct='%1.1f%%', startangle=90)
            ax.set_aspect('equal')

        elif chart_type == "donut":
            col = y_cols[0] if y_cols else df.columns[-1]
            labels = df[x_column].tolist() if x_column else df.index.tolist()
            wedges, texts, autotexts = ax.pie(df[col], labels=labels, colors=ARA[:len(df)],
                                               autopct='%1.1f%%', startangle=90, pctdistance=0.85)
            centre_circle = plt.Circle((0, 0), 0.70, fc='white')
            ax.add_artist(centre_circle)
            ax.set_aspect('equal')

        elif chart_type == "waterfall":
            if x_column and y_cols:
                values = df[y_cols[0]].tolist()
                labels_list = df[x_column].tolist()
                cumulative = np.cumsum(values)
                colors = [ARA[0] if v >= 0 else '#C5A55A' for v in values]
                bottoms = [0] + list(cumulative[:-1])
                ax.bar(labels_list, values, bottom=bottoms, color=colors, edgecolor='white')
                plt.xticks(rotation=45, ha='right')

        elif chart_type == "scatter":
            if len(y_cols) >= 1 and x_column:
                ax.scatter(df[x_column], df[y_cols[0]], c=ARA[0], s=60, alpha=0.7, edgecolors='white')

        elif chart_type == "area":
            if x_column and y_cols:
                df.plot.area(x=x_column, y=y_cols, ax=ax, color=ARA[:len(y_cols)], alpha=0.6)

        elif chart_type == "stacked_bar":
            if x_column and y_cols:
                df.plot.bar(x=x_column, y=y_cols, ax=ax, stacked=True, color=ARA[:len(y_cols)], edgecolor='white')
                plt.xticks(rotation=45, ha='right')

        elif chart_type == "heatmap":
            import seaborn as sns
            numeric_df = df.select_dtypes(include=[np.number])
            sns.heatmap(numeric_df.corr(), annot=True, cmap='YlGn', ax=ax, fmt='.2f')

        else:
            return json.dumps({"error": f"Unknown chart_type: {chart_type}", "images": []})

        ax.set_title(title, fontsize=14, fontweight='bold', color='#1A4A28', pad=15)
        if x_label:
            ax.set_xlabel(x_label)
        if y_label:
            ax.set_ylabel(y_label)

        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}' if abs(x) >= 1000 else f'{x:,.1f}'))
        ax.grid(axis='y', alpha=0.3, color='#999999')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)

        plt.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150, facecolor='white')
        buf.seek(0)
        img_b64 = base64.b64encode(buf.read()).decode('utf-8')
        buf.close()
        plt.close(fig)

        return json.dumps({
            "images": [img_b64],
            "chart_type": chart_type,
            "title": title,
            "data_points": len(df),
        })

    except Exception as e:
        plt.close('all')
        return json.dumps({"error": str(e), "traceback": traceback.format_exc(), "images": []})


@tool
def compute_statistics(data_json: str, columns: str = "") -> str:
    """Compute descriptive statistics for a dataset.

    Args:
        data_json: JSON string with rows of data
        columns: Comma-separated column names to analyze (empty = all numeric)

    Returns: JSON with statistics (mean, median, std, min, max, quartiles, etc.)
    """
    import pandas as pd
    import numpy as np

    try:
        data = json.loads(data_json) if isinstance(data_json, str) else data_json
        rows = data.get("rows", data) if isinstance(data, dict) else data
        df = pd.DataFrame(rows)
    except Exception as e:
        return json.dumps({"error": f"Cannot parse data: {e}"})

    if df.empty:
        return json.dumps({"error": "No data to analyze"})

    if columns:
        cols = [c.strip() for c in columns.split(",") if c.strip()]
        df_numeric = df[cols].apply(pd.to_numeric, errors='coerce')
    else:
        df_numeric = df.select_dtypes(include=[np.number])

    if df_numeric.empty:
        return json.dumps({"error": "No numeric columns found"})

    stats = {}
    for col in df_numeric.columns:
        series = df_numeric[col].dropna()
        stats[col] = {
            "count": int(series.count()),
            "mean": round(float(series.mean()), 2),
            "median": round(float(series.median()), 2),
            "std": round(float(series.std()), 2),
            "min": round(float(series.min()), 2),
            "max": round(float(series.max()), 2),
            "q25": round(float(series.quantile(0.25)), 2),
            "q75": round(float(series.quantile(0.75)), 2),
            "sum": round(float(series.sum()), 2),
            "null_count": int(df[col].isna().sum()) if col in df.columns else 0,
        }

    return json.dumps({"statistics": stats, "total_rows": len(df)})


ANALYTICS_TOOLS = [
    execute_python_analysis,
    generate_chart,
    compute_statistics,
]


# ---------------------------------------------------------------------------
# State & Graph
# ---------------------------------------------------------------------------

class AnalyticsState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]


def create_analytics_graph():
    """Create the Data Analytics Agent graph."""
    llm_with_tools = create_fallback_llm_with_tools(
        tools=ANALYTICS_TOOLS,
        primary_model=os.environ.get("ANALYTICS_MODEL", "openai/gpt-4o-mini"),
        tier="coding",
        temperature=0.1,
        max_tokens=2048,
        streaming=False,
    )

    def should_continue(state: AnalyticsState) -> str:
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        return END

    def call_model(state: AnalyticsState) -> dict:
        messages = list(state["messages"])
        if not messages or not isinstance(messages[0], SystemMessage):
            messages.insert(0, SystemMessage(content=ANALYTICS_PROMPT))
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(ANALYTICS_TOOLS)
    workflow = StateGraph(AnalyticsState)
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", tool_node)
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_edge("tools", "agent")

    return workflow.compile()


_analytics_graph = None

def get_analytics_graph():
    global _analytics_graph
    if _analytics_graph is None:
        _analytics_graph = create_analytics_graph()
    return _analytics_graph
