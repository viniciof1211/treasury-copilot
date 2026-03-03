"""
ERP Modules API — Facturas, Contratos por Proyecto, Hitos por Contrato
Queries PcGraf Euromobilia (siawin0) tables:
  FA00  – Encabezado Facturas
  FA01  – Detalle Facturas
  CEM0  – (auxiliary factura detail)
  IM00  – Contratos que cargan (clientes envían)
  HO00, HO01, HO03, HO05 – Detalles de contratos (sistema)
"""

import os
import logging
import decimal
import datetime as dt
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PcGraf connection (reuse env vars from server.py)
# ---------------------------------------------------------------------------
_server = os.environ.get("PCGRAF_SQL_SERVER", "")
_user = os.environ.get("PCGRAF_SQL_USER", "")
_password = os.environ.get("PCGRAF_SQL_PASSWORD", "")
_database = os.environ.get("PCGRAF_SQL_DATABASE", "siawin0")


def _connect(database: str = ""):
    import pymssql
    db = database or _database or "siawin0"
    return pymssql.connect(
        server=_server,
        user=_user,
        password=_password,
        database=db,
        login_timeout=10,
        timeout=60,
        as_dict=True,
    )


def _clean(row: dict) -> dict:
    """Make a SQL row JSON-serializable."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, (dt.datetime, dt.date)):
            out[k] = v.isoformat()
        elif isinstance(v, decimal.Decimal):
            out[k] = float(v)
        elif isinstance(v, bytes):
            out[k] = v.hex()
        elif isinstance(v, str):
            out[k] = v.strip()
        else:
            out[k] = v
    return out


def _query(sql: str, database: str = "") -> list[dict]:
    """Execute a read-only query and return cleaned rows."""
    conn = _connect(database)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        return [_clean(r) for r in rows]
    finally:
        conn.close()


def _table_exists(table: str) -> bool:
    """Check if a table exists in siawin0."""
    try:
        rows = _query(
            f"SELECT TOP 1 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
            f"WHERE TABLE_NAME = '{table}'"
        )
        return len(rows) > 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# FACTURAS  (FA00 header + FA01 detail)
# ---------------------------------------------------------------------------

async def erp_facturas(request: Request):
    """List invoices from FA00 with summary aggregates."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    params = request.query_params
    limit = min(int(params.get("limit", "200")), 5000)
    offset = int(params.get("offset", "0"))
    cliente = params.get("cliente", "")
    fecha_desde = params.get("desde", "")
    fecha_hasta = params.get("hasta", "")
    negocio = params.get("negocio", "")
    tipo = params.get("tipo", "")

    where_parts = ["1=1"]
    if cliente:
        where_parts.append(f"(sNombre_Cliente LIKE '%{cliente}%' OR sCodigo_Cliente LIKE '%{cliente}%')")
    if fecha_desde:
        where_parts.append(f"dFecha >= '{fecha_desde}'")
    if fecha_hasta:
        where_parts.append(f"dFecha <= '{fecha_hasta}'")
    if negocio:
        where_parts.append(f"sNegocio LIKE '%{negocio}%'")
    if tipo:
        where_parts.append(f"sTipoFactura = '{tipo}'")
    where = " AND ".join(where_parts)

    try:
        # Count
        count_rows = _query(f"SELECT COUNT(*) AS cnt FROM FA00 WHERE {where}")
        total = count_rows[0]["cnt"] if count_rows else 0

        # KPIs
        kpi_sql = f"""
            SELECT
                COUNT(*) AS total_facturas,
                COUNT(DISTINCT sCodigo_Cliente) AS clientes_unicos,
                SUM(CAST(cMonto_Total_Gravado AS float)) AS total_gravado,
                SUM(CAST(cMonto_Total_Impuesto AS float)) AS total_impuesto,
                SUM(CAST(cMonto_Total_Precio AS float)) AS total_precio,
                SUM(CAST(cMonto_Total_Exento AS float)) AS total_exento,
                SUM(CAST(cMonto_Total_Descuento AS float)) AS total_descuento,
                MIN(dFecha) AS fecha_min,
                MAX(dFecha) AS fecha_max
            FROM FA00 WHERE {where}
        """
        kpis = _query(kpi_sql)
        kpi = kpis[0] if kpis else {}

        # Page of invoices
        rows = _query(f"""
            SELECT
                sPedido, sFactura, sTipoFactura, dFecha, dVencimiento,
                sCodigo_Cliente, sNombre_Cliente, sNegocio, sVendedor,
                CAST(cMonto_Total_Gravado AS float) AS monto_gravado,
                CAST(cMonto_Total_Impuesto AS float) AS monto_impuesto,
                CAST(cMonto_Total_Precio AS float) AS monto_total,
                CAST(cMonto_Total_Exento AS float) AS monto_exento,
                CAST(cMonto_Total_Descuento AS float) AS monto_descuento,
                CAST(cDescuento AS float) AS pct_descuento,
                iTipo_Moneda, CAST(cTipo_Cambio_Sistema AS float) AS tipo_cambio,
                bEstado, bEstadoFactura, iPlazo, bForma_Pago, bProforma,
                sQuien_Ingreso, dFecha_Ingreso, sProyecto, sOrigen
            FROM FA00
            WHERE {where}
            ORDER BY dFecha DESC, sPedido DESC
            OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
        """)

        return JSONResponse({
            "facturas": rows,
            "total": total,
            "kpis": kpi,
            "offset": offset,
            "limit": limit,
        })
    except Exception as e:
        logger.error(f"erp_facturas error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def erp_factura_detalle(request: Request):
    """Get detail lines (FA01) for a specific invoice (sPedido)."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    pedido = request.query_params.get("pedido", "").strip()
    if not pedido:
        return JSONResponse({"error": "pedido parameter required"}, 400)

    try:
        # Header
        header = _query(f"""
            SELECT
                sPedido, sFactura, sTipoFactura, dFecha, dVencimiento,
                sCodigo_Cliente, sNombre_Cliente, sCedula, sTelefono,
                sDireccion_1, sDireccion_2, sNegocio, sVendedor, sBodega,
                CAST(cMonto_Total_Gravado AS float) AS monto_gravado,
                CAST(cMonto_Total_Impuesto AS float) AS monto_impuesto,
                CAST(cMonto_Total_Precio AS float) AS monto_total,
                CAST(cMonto_Total_Exento AS float) AS monto_exento,
                CAST(cMonto_Total_Descuento AS float) AS monto_descuento,
                CAST(cDescuento AS float) AS pct_descuento,
                iPlazo, bForma_Pago, bEstado, bEstadoFactura,
                iTipo_Moneda, CAST(cTipo_Cambio_Sistema AS float) AS tipo_cambio,
                sQuien_Ingreso, dFecha_Ingreso, sProyecto, bProforma,
                sProAtencion, sProVigencia, sProCondiciones, sProTEntrega
            FROM FA00
            WHERE sPedido = '{pedido}'
        """)

        # Lines
        lines = _query(f"""
            SELECT
                iLinea, sCodigo_Producto, sDescripcion,
                CAST(cCantidad AS float) AS cantidad,
                CAST(cCosto AS float) AS costo,
                CAST(cPrecio_Venta AS float) AS precio_venta,
                CAST(cDescuento AS float) AS descuento,
                CAST(cImpuesto_Venta AS float) AS impuesto,
                sBodega, sEmpaque,
                CAST(cCantidad AS float) * CAST(cPrecio_Venta AS float) AS subtotal,
                bEstado, sLote
            FROM FA01
            WHERE sPedido = '{pedido}'
            ORDER BY iLinea
        """)

        return JSONResponse({
            "header": header[0] if header else None,
            "lines": lines,
            "line_count": len(lines),
        })
    except Exception as e:
        logger.error(f"erp_factura_detalle error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def erp_facturas_por_negocio(request: Request):
    """Aggregate invoices by sNegocio (business unit)."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)
    try:
        rows = _query("""
            SELECT
                RTRIM(sNegocio) AS negocio,
                COUNT(*) AS num_facturas,
                COUNT(DISTINCT sCodigo_Cliente) AS clientes,
                SUM(CAST(cMonto_Total_Precio AS float)) AS total_precio,
                SUM(CAST(cMonto_Total_Gravado AS float)) AS total_gravado,
                SUM(CAST(cMonto_Total_Impuesto AS float)) AS total_impuesto,
                MIN(dFecha) AS desde,
                MAX(dFecha) AS hasta
            FROM FA00
            GROUP BY RTRIM(sNegocio)
            ORDER BY SUM(CAST(cMonto_Total_Precio AS float)) DESC
        """)
        return JSONResponse({"breakdown": rows})
    except Exception as e:
        logger.error(f"erp_facturas_por_negocio error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def erp_facturas_mensual(request: Request):
    """Monthly invoice trend aggregation."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)
    try:
        rows = _query("""
            SELECT
                YEAR(dFecha) AS anio,
                MONTH(dFecha) AS mes,
                COUNT(*) AS num_facturas,
                SUM(CAST(cMonto_Total_Precio AS float)) AS total_precio,
                SUM(CAST(cMonto_Total_Gravado AS float)) AS total_gravado,
                SUM(CAST(cMonto_Total_Impuesto AS float)) AS total_impuesto,
                COUNT(DISTINCT sCodigo_Cliente) AS clientes
            FROM FA00
            WHERE dFecha >= DATEADD(MONTH, -24, GETDATE())
            GROUP BY YEAR(dFecha), MONTH(dFecha)
            ORDER BY YEAR(dFecha), MONTH(dFecha)
        """)
        return JSONResponse({"monthly": rows})
    except Exception as e:
        logger.error(f"erp_facturas_mensual error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# CONTRATOS POR PROYECTO  (IM00 imports + HO00/HO01/HO03/HO05 contracts)
# ---------------------------------------------------------------------------

async def erp_contratos(request: Request):
    """List contracts from HO00 (main contract header) with optional IM00 imports.
    Falls back gracefully if tables don't exist."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    params = request.query_params
    limit = min(int(params.get("limit", "200")), 5000)
    offset = int(params.get("offset", "0"))
    proyecto = params.get("proyecto", "")

    try:
        # Try HO00 first (main contracts table)
        ho00_exists = _table_exists("HO00")
        contracts = []
        total = 0

        if ho00_exists:
            # Discover HO00 columns dynamically
            cols = _query(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME='HO00' ORDER BY ORDINAL_POSITION"
            )
            col_names = [c["COLUMN_NAME"] for c in cols]

            # Build select with available columns
            select_cols = ", ".join(col_names[:30])  # cap to avoid massive queries

            where = "1=1"
            if proyecto:
                # Try common column names for project filtering
                for candidate in ["sProyecto", "CodProyecto", "sContrato", "sCodigo"]:
                    if candidate in col_names:
                        where = f"{candidate} LIKE '%{proyecto}%'"
                        break

            count_rows = _query(f"SELECT COUNT(*) AS cnt FROM HO00 WHERE {where}")
            total = count_rows[0]["cnt"] if count_rows else 0

            contracts = _query(f"""
                SELECT {select_cols}
                FROM HO00
                WHERE {where}
                ORDER BY 1 DESC
                OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
            """)
        else:
            # Fallback: check if contracts are tracked via FA00.sProyecto
            where = "sProyecto <> '' AND sProyecto IS NOT NULL"
            if proyecto:
                where += f" AND sProyecto LIKE '%{proyecto}%'"

            count_rows = _query(f"SELECT COUNT(DISTINCT sProyecto) AS cnt FROM FA00 WHERE {where}")
            total = count_rows[0]["cnt"] if count_rows else 0

            contracts = _query(f"""
                SELECT
                    RTRIM(sProyecto) AS proyecto,
                    COUNT(*) AS num_facturas,
                    COUNT(DISTINCT sCodigo_Cliente) AS clientes,
                    SUM(CAST(cMonto_Total_Precio AS float)) AS total_precio,
                    SUM(CAST(cMonto_Total_Gravado AS float)) AS total_gravado,
                    MIN(dFecha) AS fecha_inicio,
                    MAX(dFecha) AS fecha_fin,
                    MIN(RTRIM(sNombre_Cliente)) AS cliente_principal
                FROM FA00
                WHERE {where}
                GROUP BY RTRIM(sProyecto)
                ORDER BY SUM(CAST(cMonto_Total_Precio AS float)) DESC
                OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
            """)

        # Also check IM00 for imported contracts
        im00_data = []
        try:
            im00_rows = _query("SELECT COUNT(*) AS cnt FROM IM00")
            if im00_rows and im00_rows[0]["cnt"] > 0:
                im00_data = _query(f"SELECT TOP {limit} * FROM IM00 ORDER BY IDLinea DESC")
        except Exception:
            pass

        return JSONResponse({
            "contracts": contracts,
            "total": total,
            "source": "HO00" if ho00_exists else "FA00_projects",
            "imports": im00_data,
            "imports_count": len(im00_data),
            "tables_available": {
                "HO00": ho00_exists,
                "IM00": _table_exists("IM00"),
            }
        })
    except Exception as e:
        logger.error(f"erp_contratos error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def erp_contrato_detalle(request: Request):
    """Get contract detail — tries HO01/HO03/HO05 for sub-items."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    contrato_id = request.query_params.get("id", "").strip()
    if not contrato_id:
        return JSONResponse({"error": "id parameter required"}, 400)

    try:
        result: dict[str, Any] = {"contract_id": contrato_id}

        # Try each HO table
        for tbl in ["HO00", "HO01", "HO03", "HO05"]:
            try:
                if not _table_exists(tbl):
                    result[tbl] = {"available": False, "rows": []}
                    continue

                # Discover columns
                cols = _query(
                    f"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    f"WHERE TABLE_NAME='{tbl}' ORDER BY ORDINAL_POSITION"
                )
                col_names = [c["COLUMN_NAME"] for c in cols]
                select_cols = ", ".join(col_names[:30])

                # Try to find the contract by common key patterns
                rows = []
                for key_col in ["sContrato", "sCodigo", "sNumero", "IDLinea", "sLlave"]:
                    if key_col in col_names:
                        rows = _query(
                            f"SELECT {select_cols} FROM [{tbl}] "
                            f"WHERE [{key_col}] LIKE '%{contrato_id}%'"
                        )
                        if rows:
                            break

                result[tbl] = {
                    "available": True,
                    "columns": col_names,
                    "rows": rows,
                    "row_count": len(rows),
                }
            except Exception as ex:
                result[tbl] = {"available": False, "error": str(ex), "rows": []}

        return JSONResponse(result)
    except Exception as e:
        logger.error(f"erp_contrato_detalle error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# HITOS POR CONTRATO (milestones from HO01/HO03/HO05)
# ---------------------------------------------------------------------------

async def erp_hitos(request: Request):
    """List milestones/hitos from HO01, HO03, HO05 tables."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    params = request.query_params
    limit = min(int(params.get("limit", "200")), 5000)
    contrato = params.get("contrato", "")

    try:
        hitos_data: dict[str, Any] = {}

        for tbl in ["HO01", "HO03", "HO05"]:
            try:
                if not _table_exists(tbl):
                    hitos_data[tbl] = {"available": False, "rows": [], "columns": []}
                    continue

                cols = _query(
                    f"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    f"WHERE TABLE_NAME='{tbl}' ORDER BY ORDINAL_POSITION"
                )
                col_names = [c["COLUMN_NAME"] for c in cols]
                select_cols = ", ".join(col_names[:30])

                where = "1=1"
                if contrato:
                    for key_col in ["sContrato", "sCodigo", "sNumero", "sLlave"]:
                        if key_col in col_names:
                            where = f"[{key_col}] LIKE '%{contrato}%'"
                            break

                rows = _query(f"""
                    SELECT TOP {limit} {select_cols}
                    FROM [{tbl}]
                    WHERE {where}
                    ORDER BY 1 DESC
                """)

                # Count total
                cnt = _query(f"SELECT COUNT(*) AS cnt FROM [{tbl}] WHERE {where}")
                total = cnt[0]["cnt"] if cnt else 0

                hitos_data[tbl] = {
                    "available": True,
                    "columns": col_names,
                    "rows": rows,
                    "row_count": len(rows),
                    "total": total,
                }
            except Exception as ex:
                hitos_data[tbl] = {"available": False, "error": str(ex), "rows": [], "columns": []}

        return JSONResponse({"hitos": hitos_data})
    except Exception as e:
        logger.error(f"erp_hitos error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# TABLE SCHEMA DISCOVERY (for any of the target tables)
# ---------------------------------------------------------------------------

async def erp_table_schema(request: Request):
    """Return column definitions for a given ERP table."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    table = request.query_params.get("table", "").strip().upper()
    allowed = {"FA00", "FA01", "CEM0", "IM00", "HO00", "HO01", "HO03", "HO05"}
    if table not in allowed:
        return JSONResponse({"error": f"Table must be one of {allowed}"}, 400)

    try:
        cols = _query(
            f"SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE "
            f"FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='{table}' ORDER BY ORDINAL_POSITION"
        )
        if not cols:
            return JSONResponse({"table": table, "exists": False, "columns": []})

        cnt = _query(f"SELECT COUNT(*) AS cnt FROM [{table}]")
        row_count = cnt[0]["cnt"] if cnt else 0

        # Sample row
        sample = _query(f"SELECT TOP 1 * FROM [{table}]")

        return JSONResponse({
            "table": table,
            "exists": True,
            "columns": cols,
            "row_count": row_count,
            "sample": sample[0] if sample else None,
        })
    except Exception as e:
        logger.error(f"erp_table_schema error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# FACTURAS KPIs (dashboard summary)
# ---------------------------------------------------------------------------

async def erp_facturas_kpis(request: Request):
    """Quick KPI summary for invoices."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)
    try:
        kpis = _query("""
            SELECT
                COUNT(*) AS total_facturas,
                COUNT(DISTINCT sCodigo_Cliente) AS clientes_unicos,
                COUNT(DISTINCT RTRIM(sNegocio)) AS negocios,
                SUM(CAST(cMonto_Total_Precio AS float)) AS sum_total,
                SUM(CAST(cMonto_Total_Gravado AS float)) AS sum_gravado,
                SUM(CAST(cMonto_Total_Impuesto AS float)) AS sum_impuesto,
                SUM(CAST(cMonto_Total_Descuento AS float)) AS sum_descuento,
                AVG(CAST(cMonto_Total_Precio AS float)) AS avg_precio,
                MIN(dFecha) AS fecha_min,
                MAX(dFecha) AS fecha_max
            FROM FA00
        """)
        # Recent 30 days
        recent = _query("""
            SELECT
                COUNT(*) AS facturas_30d,
                SUM(CAST(cMonto_Total_Precio AS float)) AS total_30d
            FROM FA00
            WHERE dFecha >= DATEADD(DAY, -30, GETDATE())
        """)

        return JSONResponse({
            "all_time": kpis[0] if kpis else {},
            "last_30_days": recent[0] if recent else {},
        })
    except Exception as e:
        logger.error(f"erp_facturas_kpis error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# TOP CLIENTES
# ---------------------------------------------------------------------------

async def erp_top_clientes(request: Request):
    """Top clients by invoice volume."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)
    limit = min(int(request.query_params.get("limit", "20")), 100)
    try:
        rows = _query(f"""
            SELECT TOP {limit}
                RTRIM(sCodigo_Cliente) AS codigo,
                RTRIM(sNombre_Cliente) AS nombre,
                COUNT(*) AS num_facturas,
                SUM(CAST(cMonto_Total_Precio AS float)) AS total_precio,
                SUM(CAST(cMonto_Total_Gravado AS float)) AS total_gravado,
                MIN(dFecha) AS primera_factura,
                MAX(dFecha) AS ultima_factura
            FROM FA00
            GROUP BY RTRIM(sCodigo_Cliente), RTRIM(sNombre_Cliente)
            ORDER BY SUM(CAST(cMonto_Total_Precio AS float)) DESC
        """)
        return JSONResponse({"clientes": rows})
    except Exception as e:
        logger.error(f"erp_top_clientes error: {e}")
        return JSONResponse({"error": str(e)}, 500)


# ---------------------------------------------------------------------------
# CONTRACT DOCUMENT VIEWER — CEM0.dbo.IM00
# ---------------------------------------------------------------------------
# IM00 schema (discovered from CEM0):
#   IDLinea        int        PK, auto-increment
#   CodProyecto    int        FK → HO00.IdLinea (project)
#   NombreDocumento nvarchar(50)  display name
#   Grupo          int        document group/category
#   Observaciones  nvarchar(250) notes
#   Data           image      raw file blob (PDF, PNG, JPG, etc.)
#   Extension      nchar(10)  e.g. ".pdf", ".jpg", ".png"
#   QuienIngreso   nvarchar(50)  uploaded by
#   QuienModifico  nvarchar(50)  modified by
#   FechaIngreso   datetime   upload date
#   FechaModifico  datetime   last modified
#   FileName       nvarchar(150) original file path (truncated)
#   Supervisor     varchar(40)
#
# HO00 schema (project header):
#   IdLinea        int        PK
#   Descripcion    nvarchar   project description/name
#   CodCliente     nvarchar   client code
#   CodAsesor      nvarchar   advisor code
#   TotalOferta    decimal    offer total
#   Estado         int        status
#
# Stats: ~13,600 documents, ~3,300 projects, 89% PDF

_EXT_CONTENT_TYPE: dict[str, str] = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".msg": "application/vnd.ms-outlook",
}


def _connect_cem0(as_dict: bool = True):
    """Connect to the CEM0 catalog on PcGraf."""
    import pymssql
    return pymssql.connect(
        server=_server,
        user=_user,
        password=_password,
        database="CEM0",
        login_timeout=10,
        timeout=60,
        as_dict=as_dict,
    )


def _query_cem0(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a parameterised read-only query on CEM0."""
    conn = _connect_cem0()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params) if params else cursor.execute(sql)
        rows = cursor.fetchall()
        return [_clean(r) for r in rows]
    finally:
        conn.close()


async def contract_pdf_schema(request: Request):
    """GET /contracts/pdf/schema — Return IM00 table stats and schema."""
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)
    try:
        stats = _query_cem0(
            "SELECT COUNT(*) AS total_docs, "
            "COUNT(DISTINCT CodProyecto) AS total_projects, "
            "SUM(CASE WHEN Data IS NOT NULL AND DATALENGTH(Data)>0 THEN 1 ELSE 0 END) AS with_data "
            "FROM IM00"
        )
        exts = _query_cem0(
            "SELECT RTRIM(Extension) AS ext, COUNT(*) AS cnt "
            "FROM IM00 GROUP BY RTRIM(Extension) ORDER BY cnt DESC"
        )
        return JSONResponse({
            "table": "CEM0.dbo.IM00",
            "stats": stats[0] if stats else {},
            "extensions": exts,
        })
    except Exception as e:
        logger.error(f"contract_pdf_schema error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def contract_pdf_list(request: Request):
    """GET /contracts/pdf/list — List documents from CEM0.IM00 joined with HO00 project info.

    Query params:
        q        — free text search on NombreDocumento, FileName, Observaciones
        proyecto — filter by CodProyecto (int)
        ext      — filter by Extension (e.g. ".pdf")
        limit    — max rows (default 100)
        offset   — pagination offset
    """
    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    params = request.query_params
    limit = min(int(params.get("limit", "100")), 2000)
    offset = int(params.get("offset", "0"))
    search = params.get("q", "").strip()
    proyecto = params.get("proyecto", "").strip()
    ext_filter = params.get("ext", "").strip().lower()

    try:
        where_parts = ["1=1"]
        if search:
            safe = search.replace("'", "''")
            where_parts.append(
                f"(i.NombreDocumento LIKE '%{safe}%' "
                f"OR i.FileName LIKE '%{safe}%' "
                f"OR i.Observaciones LIKE '%{safe}%' "
                f"OR h.Descripcion LIKE '%{safe}%')"
            )
        if proyecto:
            where_parts.append(f"i.CodProyecto = {int(proyecto)}")
        if ext_filter:
            safe_ext = ext_filter.replace("'", "''")
            where_parts.append(f"RTRIM(LOWER(i.Extension)) = '{safe_ext}'")
        where = " AND ".join(where_parts)

        # Count
        cnt = _query_cem0(
            f"SELECT COUNT(*) AS cnt FROM IM00 i "
            f"LEFT JOIN HO00 h ON h.IdLinea = i.CodProyecto "
            f"WHERE {where}"
        )
        total = cnt[0]["cnt"] if cnt else 0

        # Rows (no blob)
        rows = _query_cem0(f"""
            SELECT
                i.IDLinea,
                i.CodProyecto,
                RTRIM(i.NombreDocumento) AS nombre_documento,
                RTRIM(i.Extension) AS extension,
                i.Grupo,
                RTRIM(i.Observaciones) AS observaciones,
                RTRIM(i.FileName) AS file_name,
                RTRIM(i.QuienIngreso) AS quien_ingreso,
                i.FechaIngreso AS fecha_ingreso,
                RTRIM(i.Supervisor) AS supervisor,
                DATALENGTH(i.Data) AS data_size,
                CASE WHEN i.Data IS NOT NULL AND DATALENGTH(i.Data) > 0
                     THEN 1 ELSE 0 END AS has_file,
                RTRIM(h.Descripcion) AS proyecto_nombre,
                RTRIM(h.CodCliente) AS proyecto_cliente,
                h.TotalOferta AS proyecto_monto,
                h.Estado AS proyecto_estado
            FROM IM00 i
            LEFT JOIN HO00 h ON h.IdLinea = i.CodProyecto
            WHERE {where}
            ORDER BY i.IDLinea DESC
            OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
        """)

        return JSONResponse({
            "documents": rows,
            "total": total,
            "offset": offset,
            "limit": limit,
        })
    except Exception as e:
        logger.error(f"contract_pdf_list error: {e}")
        return JSONResponse({"error": str(e)}, 500)


async def contract_pdf_serve(request: Request):
    """GET /contracts/pdf/{id} — Serve the raw file blob from CEM0.IM00.

    Detects content type from Extension column and file magic bytes.
    """
    from starlette.responses import Response

    if not _server:
        return JSONResponse({"error": "PcGraf not configured"}, 500)

    doc_id = request.path_params.get("id", "").strip()
    if not doc_id:
        return JSONResponse({"error": "Document ID (IDLinea) required"}, 400)

    try:
        # Fetch blob + extension using raw cursor (not as_dict) for binary fidelity
        import pymssql
        conn = pymssql.connect(
            server=_server,
            user=_user,
            password=_password,
            database="CEM0",
            login_timeout=10,
            timeout=120,
        )
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT [Data], RTRIM([Extension]) AS ext, "
                "RTRIM([NombreDocumento]) AS nombre FROM IM00 WHERE IDLinea = %s",
                (int(doc_id),),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        if not row or not row[0]:
            return JSONResponse({"error": f"No file data for document {doc_id}"}, 404)

        file_bytes = bytes(row[0])
        ext = (row[1] or "").strip().lower()
        nombre = (row[2] or f"document_{doc_id}").strip()

        # Determine content type: prefer Extension column, fallback to magic bytes
        content_type = _EXT_CONTENT_TYPE.get(ext, "")
        if not content_type:
            if file_bytes[:4] == b'%PDF':
                content_type = "application/pdf"
            elif file_bytes[:2] == b'PK':
                content_type = "application/zip"
            elif file_bytes[:4] == b'\x89PNG':
                content_type = "image/png"
            elif file_bytes[:2] == b'\xff\xd8':
                content_type = "image/jpeg"
            else:
                content_type = "application/octet-stream"

        # Build safe filename
        safe_name = nombre
        if ext and not safe_name.lower().endswith(ext):
            safe_name = f"{safe_name}{ext}"

        return Response(
            content=file_bytes,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_name}"',
                "Content-Length": str(len(file_bytes)),
                "Cache-Control": "public, max-age=3600",
            },
        )
    except Exception as e:
        logger.error(f"contract_pdf_serve error: {e}")
        return JSONResponse({"error": str(e)}, 500)
