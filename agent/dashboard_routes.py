"""Shared route handlers for Data Model, CDC, PcGraf, TICA, and Code Mapping.

These are used by both server.py (local/Azure) and modal_app.py (Modal deployment)
so that the frontend always hits the same API surface regardless of backend host.
"""

import os
import re
import logging
import unicodedata

from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# Data Model Dashboard
# ═══════════════════════════════════════════════════════════════════════════

async def data_model_schema(request: Request):
    """Return full schema for ER diagram: all tables with columns, PKs, FKs, row counts."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    try:
        import httpx
        headers = {"Authorization": f"Bearer {sb_key}", "apikey": sb_key}
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
        resp = httpx.post(
            f"{sb_url}/rest/v1/rpc/exec_sql",
            headers={**headers, "Content-Type": "application/json"},
            json={"sql_query": sql},
            timeout=30.0,
        )
        tables = resp.json() if resp.status_code == 200 else []
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
        resp2 = httpx.post(
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
    """Get Kafka cluster and topic status."""
    try:
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
                cursor.execute(f"""
                    SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH,
                           c.IS_NULLABLE, c.ORDINAL_POSITION
                    FROM INFORMATION_SCHEMA.COLUMNS c
                    WHERE c.TABLE_NAME = %s
                    ORDER BY c.ORDINAL_POSITION
                """, (table_name,))
                columns = cursor.fetchall()
                cursor.execute(f"SELECT COUNT(*) as cnt FROM [{table_name}]")
                row_count = cursor.fetchone()["cnt"]
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
    """Save curated data changes to Supabase and/or PcGraf ERP."""
    body = await request.json()
    table = body.get("table", "")
    schema = body.get("schema", "tms")
    row_id = body.get("row_id")
    changes = body.get("changes", {})
    targets = body.get("targets", ["supabase", "faiss"])
    results = {}

    if not table or not changes:
        return JSONResponse({"error": "table and changes required"}, status_code=400)

    if "supabase" in targets:
        try:
            sb_url = os.environ.get("SUPABASE_URL", "")
            sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
            import httpx
            profile = "tms" if schema == "tms" else "public"
            resp = httpx.patch(
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

    if "faiss" in targets:
        try:
            from agent.knowledge_base import incremental_sync
            incremental_sync()
            results["faiss"] = {"status": "ok"}
        except Exception as e:
            results["faiss"] = {"status": "error", "message": str(e)}

    return JSONResponse({"results": results})


# ═══════════════════════════════════════════════════════════════════════════
# CDC (Change Data Capture)
# ═══════════════════════════════════════════════════════════════════════════

async def cdc_status(request: Request):
    """Get CDC watermarks and status for all tracked tables."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    tms_headers = {"Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Accept-Profile": "tms"}
    try:
        import httpx
        resp = httpx.get(
            f"{sb_url}/rest/v1/cdc_watermarks?select=*&order=sql_table_name",
            headers=tms_headers,
            timeout=15.0,
        )
        watermarks = resp.json() if resp.status_code == 200 else []
        resp2 = httpx.get(
            f"{sb_url}/rest/v1/cdc_events?select=sql_table_name,event_type&order=detected_at.desc&limit=500",
            headers=tms_headers,
            timeout=15.0,
        )
        events = resp2.json() if resp2.status_code == 200 else []
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
    table = body.get("table")
    try:
        from agent.cdc.poller import CDCPoller
        from agent.cdc.config import CDC_TABLES
        poller = CDCPoller(kafka_producer=None)
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
        import httpx
        resp = httpx.get(
            f"{sb_url}/rest/v1/table_registry?select=*&order=erp_module,entity_name",
            headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Accept-Profile": "tms"},
            timeout=15.0,
        )
        return JSONResponse({"tables": resp.json() if resp.status_code == 200 else []})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════
# PcGraf ERP SQL Server proxy
# ═══════════════════════════════════════════════════════════════════════════

def _get_pcgraf_conn():
    """Get a pymssql connection to PcGraf using env vars."""
    import pymssql
    return pymssql.connect(
        server=os.environ.get("PCGRAF_SQL_SERVER", "192.168.1.3"),
        user=os.environ.get("PCGRAF_SQL_USER", ""),
        password=os.environ.get("PCGRAF_SQL_PASSWORD", ""),
        database=os.environ.get("PCGRAF_SQL_DATABASE", ""),
    )


async def pcgraf_query(request: Request):
    """Execute read-only SQL on PcGraf."""
    body = await request.json()
    sql = body.get("sql", "")
    if not sql:
        return JSONResponse({"error": "sql required"}, status_code=400)
    sql_upper = sql.strip().upper()
    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("EXEC")):
        return JSONResponse({"error": "Only SELECT / EXEC allowed"}, status_code=400)
    try:
        conn = _get_pcgraf_conn()
        cursor = conn.cursor(as_dict=True)
        cursor.execute(sql)
        rows = cursor.fetchall()
        conn.close()
        return JSONResponse({"rows": rows, "count": len(rows)})
    except Exception as e:
        return JSONResponse({"rows": [], "error": str(e)}, status_code=500)


async def pcgraf_databases(request: Request):
    """List databases on PcGraf server."""
    try:
        conn = _get_pcgraf_conn()
        cursor = conn.cursor(as_dict=True)
        cursor.execute("SELECT name FROM sys.databases ORDER BY name")
        rows = cursor.fetchall()
        conn.close()
        return JSONResponse({"databases": [r["name"] for r in rows]})
    except Exception as e:
        return JSONResponse({"databases": [], "error": str(e)}, status_code=500)


async def pcgraf_tables(request: Request):
    """List tables in a database."""
    db = request.query_params.get("database", "")
    try:
        conn = _get_pcgraf_conn()
        cursor = conn.cursor(as_dict=True)
        cursor.execute(f"SELECT TABLE_NAME FROM [{db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")
        rows = cursor.fetchall()
        conn.close()
        return JSONResponse({"tables": [r["TABLE_NAME"] for r in rows], "database": db})
    except Exception as e:
        return JSONResponse({"tables": [], "error": str(e)}, status_code=500)


async def pcgraf_health(request: Request):
    """Check PcGraf connectivity."""
    try:
        conn = _get_pcgraf_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 AS ok")
        cursor.fetchone()
        conn.close()
        return JSONResponse({"status": "ok", "server": os.environ.get("PCGRAF_SQL_SERVER", "")})
    except Exception as e:
        return JSONResponse({"status": "error", "error": str(e)}, status_code=500)


async def pcgraf_backup(request: Request):
    """Stub for PcGraf backup endpoint."""
    return JSONResponse({"status": "not_implemented", "message": "Backup via SQL Server agent, not web API"})


async def pcgraf_backup_list(request: Request):
    """Stub for PcGraf backup list."""
    return JSONResponse({"backups": [], "message": "No backups tracked via web API"})


# ═══════════════════════════════════════════════════════════════════════════
# TICA / Aduanas
# ═══════════════════════════════════════════════════════════════════════════

TICA_BASE_URL = "https://www.hacienda.go.cr"

async def tica_health(request: Request):
    """Check TICA connectivity."""
    try:
        import httpx
        resp = httpx.get(f"{TICA_BASE_URL}/Tica/hcimppon.aspx", timeout=10.0)
        return JSONResponse({"status": "ok" if resp.status_code == 200 else "degraded", "code": resp.status_code})
    except Exception as e:
        return JSONResponse({"status": "error", "error": str(e)}, status_code=500)


async def tica_search_duas(request: Request):
    """Search DUAs by cedula on TICA website (scraping)."""
    body = await request.json()
    cedula = body.get("cedula", "")
    fecha_inicio = body.get("fecha_inicio", "")
    fecha_fin = body.get("fecha_fin", "")
    aduana = body.get("aduana", "0")
    if not cedula:
        return JSONResponse({"error": "cedula required"}, status_code=400)
    try:
        import httpx as _httpx
        session = _httpx.Client(timeout=20.0, follow_redirects=True)
        page = session.get(f"{TICA_BASE_URL}/Tica/hcimppon.aspx")
        html = page.text

        def extract_hidden(name: str, html_text: str) -> str:
            m = re.search(rf'id="{name}"\s+value="([^"]*)"', html_text)
            return m.group(1) if m else ""

        viewstate = extract_hidden("__VIEWSTATE", html)
        validation = extract_hidden("__EVENTVALIDATION", html)
        viewstate_gen = extract_hidden("__VIEWSTATEGENERATOR", html)
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
        duas = []
        table_match = re.search(r'<table[^>]*id="gvResultados"[^>]*>(.*?)</table>', result_html, re.DOTALL)
        if table_match:
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_match.group(1), re.DOTALL)
            for row in rows[1:]:
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                if len(cells) >= 6:
                    duas.append({
                        "dua_number": cells[0], "fecha": cells[1],
                        "importador": cells[2] if len(cells) > 2 else cedula,
                        "aduana": cells[3] if len(cells) > 3 else "",
                        "regimen": cells[4] if len(cells) > 4 else "",
                        "estado": cells[5] if len(cells) > 5 else "",
                        "valor_cif": 0, "valor_fob": 0, "flete": 0, "seguro": 0,
                        "dai_total": 0, "iva_total": 0, "total_impuestos": 0, "lineas": [],
                    })
        return JSONResponse({"duas": duas, "count": len(duas), "source": "tica_scrape",
            "note": "TICA does not provide a public REST API; data is scraped from the web interface."})
    except Exception as e:
        logger.error(f"TICA DUA search error: {e}")
        return JSONResponse({"duas": [], "error": str(e)}, status_code=500)


async def tica_lookup_partida(request: Request):
    """Lookup a partida arancelaria code and return DAI/IVA rates."""
    codigo = request.query_params.get("codigo", "")
    if not codigo:
        return JSONResponse({"error": "codigo query param required"}, status_code=400)
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
        "93": 15, "94": 10, "95": 15, "96": 10, "97": 0, "98": 0, "99": 0,
    }
    chapter = codigo[:2] if len(codigo) >= 2 else "00"
    dai = DAI_RATES.get(chapter, 5)
    iva = 13
    tlc_list = []
    if dai > 0:
        tlc_list = ["CAFTA-DR (USA)", "UE-CA", "China-CR", "Colombia-CR", "Mexico-CR", "Peru-CR", "Singapore-CR", "EFTA-CA"]
    return JSONResponse({
        "partida": {
            "codigo": codigo, "descripcion": f"Partida {codigo} - Capítulo {chapter}",
            "dai_pct": dai, "iva_pct": iva,
            "notas": f"DAI base: {dai}%. Puede variar según subpartida específica y TLC aplicable.",
            "tlc_aplicable": tlc_list,
        }
    })


async def tica_conciliate(request: Request):
    """Conciliate DUA line items against internal purchase order items."""
    body = await request.json()
    dua_number = body.get("dua_number", "")
    internal_items = body.get("internal_items", [])
    if not internal_items:
        return JSONResponse({"error": "internal_items required"}, status_code=400)
    return JSONResponse({
        "dua_number": dua_number, "matched": [], "unmatched_dua": [],
        "unmatched_internal": [{"codigo": i["codigo"], "descripcion": i.get("descripcion", "")} for i in internal_items],
        "note": "Conciliation requires DUA line item data. Use searchDUAs first.",
    })


# ═══════════════════════════════════════════════════════════════════════════
# AI Code Mapping
# ═══════════════════════════════════════════════════════════════════════════

def _normalize_text(s: str) -> str:
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
    """Match vendor items to internal codes using multi-signal similarity."""
    body = await request.json()
    vendor_items = body.get("vendor_items", [])
    threshold = body.get("match_threshold", 0.15)
    if not vendor_items:
        return JSONResponse({"error": "vendor_items required"}, status_code=400)

    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)

    try:
        import httpx
        resp = httpx.get(
            f"{sb_url}/rest/v1/mrp_master?select=codigo,descripcion,proveedor,familia&limit=5000",
            headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Accept": "application/json"},
            timeout=15.0,
        )
        internal_items = resp.json() if resp.status_code == 200 else []
    except Exception as e:
        return JSONResponse({"error": f"Failed to fetch internal items: {e}"}, status_code=500)

    if not internal_items:
        return JSONResponse({"mappings": [], "note": "No internal items found in mrp_master"})

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
            if it["code_norm"] == v_code and v_code:
                score += 0.5
                method = "exact"
                reasons.append("exact_code")
            elif v_code and it["code_norm"]:
                max_len = max(len(v_code), len(it["code_norm"]))
                common = sum(1 for a, b in zip(v_code, it["code_norm"]) if a == b)
                cs = common / max_len if max_len else 0
                if cs > 0.7:
                    score += cs * 0.3
                    reasons.append(f"code_sim_{cs:.0%}")
            j = _jaccard(v_tokens, it["tokens"])
            if j > 0.1:
                score += j * 0.4
                reasons.append(f"desc_jaccard_{j:.0%}")
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
                "codigo_interno": None, "descripcion_interna": None,
                "similarity_score": 0, "match_method": "none",
                "confirmed": False, "candidates": [],
            })
    return JSONResponse({"mappings": mappings, "count": len(mappings)})


async def code_mapping_save(request: Request):
    """Save confirmed code mappings to Supabase."""
    body = await request.json()
    mappings = body.get("mappings", [])
    if not mappings:
        return JSONResponse({"error": "mappings required"}, status_code=400)
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    try:
        import httpx
        rows = [{
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
        } for m in mappings]
        resp = httpx.post(
            f"{sb_url}/rest/v1/code_mappings",
            json=rows,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {sb_key}", "apikey": sb_key, "Prefer": "return=minimal"},
            timeout=15.0,
        )
        if resp.status_code in (200, 201):
            return JSONResponse({"saved": len(rows)})
        return JSONResponse({"error": resp.text, "saved": 0}, status_code=500)
    except Exception as e:
        return JSONResponse({"error": str(e), "saved": 0}, status_code=500)


async def code_mapping_list(request: Request):
    """List existing code mappings."""
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        return JSONResponse({"error": "Supabase not configured"}, status_code=500)
    proveedor = request.query_params.get("proveedor", "")
    confirmed = request.query_params.get("confirmed", "")
    try:
        import httpx
        url = f"{sb_url}/rest/v1/code_mappings?select=*&order=created_at.desc&limit=200"
        if proveedor:
            url += f"&proveedor=eq.{proveedor}"
        if confirmed == "true":
            url += "&confirmed=eq.true"
        resp = httpx.get(url, headers={"Authorization": f"Bearer {sb_key}", "apikey": sb_key}, timeout=15.0)
        return JSONResponse({"mappings": resp.json() if resp.status_code == 200 else []})
    except Exception as e:
        return JSONResponse({"error": str(e), "mappings": []}, status_code=500)
