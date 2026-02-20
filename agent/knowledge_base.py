"""Unified FAISS Knowledge Base — single source of truth for the entire TMS.

Ingests ALL data sources:
  1. silver_finance.* tables (cxp_items, flujo_semanal, mrp_master, projection_12m, cxc_items)
  2. tms.* canonical ERP tables (productos, proveedores, ordenes_compra, facturas, etc.)
  3. Excel/DOCX files from /doc directory
  4. CDC events (tms.cdc_events) for real-time change tracking
  5. Code mappings (silver_finance.code_mappings)

Auto-sync every 4 minutes. CDC-triggered rebuild on demand.
Provides bounded-context to ALL BI charts, tables, and AI chat.
"""

import os
import json
import logging
import threading
import time
import hashlib
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

import httpx
import pandas as pd
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_vectorstore: Optional[FAISS] = None
_FAISS_INDEX_DIR = os.environ.get("FAISS_INDEX_DIR", "/tmp/treasury_faiss_index")
_sync_thread: Optional[threading.Thread] = None
_sync_running = False
_last_sync_hash: str = ""
_last_sync_at: Optional[str] = None
_sync_stats: dict = {"total_chunks": 0, "sources": {}, "last_duration_s": 0}

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SYNC_INTERVAL_SECONDS = int(os.environ.get("KB_SYNC_INTERVAL", "240"))  # 4 min


def _get_embeddings() -> HuggingFaceEmbeddings:
    """Use sentence-transformers for local embeddings (no API key needed)."""
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def _sb_headers(schema: str = "public") -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept-Profile": schema,
    }


def _sb_get(path: str, schema: str = "public", limit: int = 2000) -> list[dict]:
    """Fetch rows from Supabase REST API."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return []
    try:
        sep = "&" if "?" in path else "?"
        url = f"{SUPABASE_URL}/rest/v1/{path}{sep}limit={limit}"
        resp = httpx.get(url, headers=_sb_headers(schema), timeout=30.0)
        return resp.json() if resp.status_code == 200 and isinstance(resp.json(), list) else []
    except Exception as e:
        logger.warning(f"Supabase GET {path} error: {e}")
        return []


# ---------------------------------------------------------------------------
# Row → Document conversion
# ---------------------------------------------------------------------------

def _rows_to_docs(rows: list[dict], table_name: str, display_name: str,
                  schema: str = "public", chunk_size: int = 15) -> list[Document]:
    """Convert DB rows into chunked LangChain Documents for FAISS indexing."""
    docs = []
    if not rows:
        return docs
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        lines = [f"{display_name} ({schema}.{table_name}) — rows {i+1}-{i+len(chunk)} of {len(rows)}"]
        cols = list(chunk[0].keys()) if chunk else []
        lines.append("Campos: " + ", ".join(cols[:20]))
        for r in chunk:
            parts = []
            for k, v in r.items():
                if v is not None and str(v).strip() and str(v) != "None":
                    sv = str(v).strip()
                    if len(sv) > 120:
                        sv = sv[:120] + "…"
                    parts.append(f"{k}={sv}")
            if parts:
                lines.append(" | ".join(parts[:15]))
        text = "\n".join(lines)
        docs.append(Document(
            page_content=text[:3000],
            metadata={
                "source": f"supabase_{schema}",
                "table": table_name,
                "display_name": display_name,
                "schema": schema,
                "type": "db_sync",
                "row_start": i + 1,
                "row_end": i + len(chunk),
                "total_rows": len(rows),
                "synced_at": datetime.now(timezone.utc).isoformat(),
            },
        ))
    return docs


# ---------------------------------------------------------------------------
# Excel / DOCX → Documents
# ---------------------------------------------------------------------------

def _excel_to_documents(file_path: str, source_name: str) -> list[Document]:
    """Convert an Excel file into LangChain Documents (one per row-group)."""
    docs: list[Document] = []
    try:
        xls = pd.ExcelFile(file_path, engine="openpyxl")
    except Exception as e:
        logger.warning(f"Cannot read {file_path}: {e}")
        return docs

    for sheet_name in xls.sheet_names:
        try:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=0)
        except Exception:
            continue
        if df.empty or len(df.columns) < 2:
            continue
        df.columns = [str(c).strip() for c in df.columns]
        chunk_size = 20
        for start in range(0, len(df), chunk_size):
            chunk = df.iloc[start:start + chunk_size]
            lines = [f"Sheet: {sheet_name} | Rows {start+1}-{start+len(chunk)}"]
            lines.append("Columns: " + ", ".join(df.columns.tolist()))
            for _, row in chunk.iterrows():
                row_parts = []
                for col in df.columns:
                    val = row[col]
                    if pd.notna(val) and str(val).strip():
                        row_parts.append(f"{col}: {val}")
                if row_parts:
                    lines.append(" | ".join(row_parts))
            text = "\n".join(lines)
            docs.append(Document(
                page_content=text,
                metadata={"source": source_name, "sheet": sheet_name,
                          "row_start": start + 1, "row_end": start + len(chunk), "type": "excel_data"},
            ))
    return docs


def _docx_to_documents(file_path: str) -> list[Document]:
    """Extract text from a .docx file."""
    docs = []
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        with zipfile.ZipFile(file_path) as z:
            with z.open("word/document.xml") as doc_xml:
                tree = ET.parse(doc_xml)
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                paragraphs = tree.findall(".//w:p", ns)
                text_parts = []
                for p in paragraphs:
                    runs = p.findall(".//w:t", ns)
                    para_text = "".join(r.text or "" for r in runs)
                    if para_text.strip():
                        text_parts.append(para_text.strip())
                if text_parts:
                    full_text = "\n".join(text_parts)
                    for i in range(0, len(full_text), 500):
                        docs.append(Document(
                            page_content=full_text[i:i + 500],
                            metadata={"source": Path(file_path).name, "type": "docx_text"},
                        ))
    except Exception as e:
        logger.warning(f"Cannot read docx {file_path}: {e}")
    return docs


# ---------------------------------------------------------------------------
# FULL SYNC — pulls ALL data from ALL sources
# ---------------------------------------------------------------------------

# Tables to sync from each schema with display names
SILVER_FINANCE_TABLES = {
    "cxp_items":       {"display": "Cuentas por Pagar (CxP)",       "limit": 1000, "order": "created_at.desc"},
    "flujo_semanal":   {"display": "Flujo Semanal Operaciones",     "limit": 1000, "order": "created_at.desc"},
    "mrp_master":      {"display": "MRP Planning de Compras",       "limit": 2000, "order": "created_at.desc"},
    "cxc_items":       {"display": "Cuentas por Cobrar (CxC)",      "limit": 1000, "order": "created_at.desc"},
    "projection_12m":  {"display": "Proyección Flujo 12 Meses",     "limit": 500,  "order": "created_at.desc"},
    "curation_log":    {"display": "Log de Curación de Datos",      "limit": 500,  "order": "edited_at.desc"},
    "code_mappings":   {"display": "Mapeo Códigos Proveedor↔Interno", "limit": 500, "order": "created_at.desc"},
}

TMS_TABLES = {
    "productos":           {"display": "Productos / Artículos (ERP)",       "limit": 5000, "order": "updated_at.desc"},
    "proveedores":         {"display": "Proveedores (ERP)",                 "limit": 1000, "order": "updated_at.desc"},
    "clientes":            {"display": "Clientes (ERP)",                    "limit": 2000, "order": "updated_at.desc"},
    "ordenes_compra":      {"display": "Órdenes de Compra (ERP)",           "limit": 2000, "order": "updated_at.desc"},
    "lineas_oc":           {"display": "Líneas de OC (ERP)",                "limit": 3000, "order": "created_at.desc"},
    "facturas":            {"display": "Facturas (ERP)",                    "limit": 2000, "order": "updated_at.desc"},
    "lineas_factura":      {"display": "Líneas de Factura (ERP)",           "limit": 3000, "order": "created_at.desc"},
    "cuentas_por_pagar":   {"display": "CxP ERP (Documentos)",              "limit": 2000, "order": "updated_at.desc"},
    "cuentas_por_cobrar":  {"display": "CxC ERP (Documentos)",              "limit": 2000, "order": "updated_at.desc"},
    "inventario_bodega":   {"display": "Inventario por Bodega (ERP)",       "limit": 3000, "order": "updated_at.desc"},
    "movimientos_bancarios": {"display": "Movimientos Bancarios (ERP)",     "limit": 2000, "order": "updated_at.desc"},
    "plan_cuentas":        {"display": "Plan de Cuentas Contable (ERP)",    "limit": 1000, "order": "created_at.desc"},
    "tipos_cambio":        {"display": "Tipos de Cambio Histórico (ERP)",   "limit": 500,  "order": "fecha.desc"},
    "bodegas":             {"display": "Bodegas / Almacenes (ERP)",         "limit": 100,  "order": "created_at.desc"},
    "table_registry":      {"display": "Registro de Tablas ERP↔TMS",       "limit": 100,  "order": "id"},
    "cdc_events":          {"display": "Eventos CDC (Cambios Detectados)",  "limit": 500,  "order": "detected_at.desc"},
}


def full_sync() -> dict:
    """Pull ALL data from ALL Supabase schemas and rebuild the FAISS index.
    This is the single source of truth sync — replaces the entire index."""
    global _vectorstore, _last_sync_hash, _last_sync_at, _sync_stats
    start_time = time.time()
    all_docs: list[Document] = []
    source_stats: dict = {}

    logger.info("═══ KB Full Sync starting ═══")

    # ── 1. silver_finance tables ───────────────────────────────────────────
    for table, cfg in SILVER_FINANCE_TABLES.items():
        try:
            order = cfg.get("order", "created_at.desc")
            rows = _sb_get(f"{table}?select=*&order={order}", schema="silver_finance", limit=cfg["limit"])
            if rows:
                docs = _rows_to_docs(rows, table, cfg["display"], "silver_finance")
                all_docs.extend(docs)
                source_stats[f"silver_finance.{table}"] = {"rows": len(rows), "chunks": len(docs)}
                logger.info(f"  silver_finance.{table}: {len(rows)} rows → {len(docs)} chunks")
        except Exception as e:
            logger.error(f"  silver_finance.{table} sync error: {e}")

    # ── 2. tms.* canonical ERP tables ──────────────────────────────────────
    for table, cfg in TMS_TABLES.items():
        try:
            order = cfg.get("order", "created_at.desc")
            rows = _sb_get(f"{table}?select=*&order={order}", schema="tms", limit=cfg["limit"])
            if rows:
                docs = _rows_to_docs(rows, table, cfg["display"], "tms")
                all_docs.extend(docs)
                source_stats[f"tms.{table}"] = {"rows": len(rows), "chunks": len(docs)}
                logger.info(f"  tms.{table}: {len(rows)} rows → {len(docs)} chunks")
        except Exception as e:
            logger.error(f"  tms.{table} sync error: {e}")

    # ── 3. Local Excel/DOCX files ──────────────────────────────────────────
    doc_dir = Path(os.environ.get("DOC_DIR", "/app/doc"))
    if doc_dir.exists():
        for f in doc_dir.glob("*.xlsx"):
            docs = _excel_to_documents(str(f), f.name)
            all_docs.extend(docs)
            source_stats[f"file:{f.name}"] = {"chunks": len(docs)}
            logger.info(f"  file:{f.name}: {len(docs)} chunks")
        for f in doc_dir.glob("*.docx"):
            docs = _docx_to_documents(str(f))
            all_docs.extend(docs)
            source_stats[f"file:{f.name}"] = {"chunks": len(docs)}
        summary = doc_dir / "PROCESS_SUMMARY.md"
        if summary.exists():
            text = summary.read_text(encoding="utf-8")
            for i in range(0, len(text), 500):
                all_docs.append(Document(
                    page_content=text[i:i + 500],
                    metadata={"source": "PROCESS_SUMMARY.md", "type": "markdown"},
                ))
            source_stats["PROCESS_SUMMARY.md"] = {"chunks": len(text) // 500 + 1}

    # ── 4. Check if data changed (skip rebuild if identical) ───────────────
    content_hash = hashlib.md5(
        json.dumps([d.page_content[:100] for d in all_docs[:200]], sort_keys=True).encode()
    ).hexdigest()

    if content_hash == _last_sync_hash and _vectorstore is not None:
        elapsed = time.time() - start_time
        logger.info(f"═══ KB Sync: no changes detected ({elapsed:.1f}s) ═══")
        return {"status": "no_change", "chunks": len(all_docs), "duration_s": elapsed}

    # ── 5. Build FAISS index ───────────────────────────────────────────────
    if not all_docs:
        all_docs = [Document(page_content="Treasury Knowledge Base — awaiting data sync.", metadata={"source": "system"})]

    logger.info(f"Building FAISS index with {len(all_docs)} chunks...")
    embeddings = _get_embeddings()
    _vectorstore = FAISS.from_documents(all_docs, embeddings)

    os.makedirs(_FAISS_INDEX_DIR, exist_ok=True)
    _vectorstore.save_local(_FAISS_INDEX_DIR)

    _last_sync_hash = content_hash
    _last_sync_at = datetime.now(timezone.utc).isoformat()
    elapsed = time.time() - start_time

    _sync_stats = {
        "total_chunks": len(all_docs),
        "sources": source_stats,
        "last_duration_s": round(elapsed, 1),
        "last_sync_at": _last_sync_at,
    }

    logger.info(f"═══ KB Full Sync complete: {len(all_docs)} chunks in {elapsed:.1f}s ═══")
    return {"status": "rebuilt", "chunks": len(all_docs), "sources": source_stats, "duration_s": elapsed}


# ---------------------------------------------------------------------------
# Incremental sync — for CDC-triggered updates
# ---------------------------------------------------------------------------

def incremental_sync(table: str, schema: str, rows: list[dict]) -> int:
    """Add new/updated rows to the existing FAISS index without full rebuild.
    Called by CDC pipeline when changes are detected."""
    global _vectorstore
    if not rows:
        return 0

    display = f"CDC Update: {schema}.{table}"
    docs = _rows_to_docs(rows, table, display, schema)
    if not docs:
        return 0

    vs = get_vectorstore()
    if vs is not None:
        vs.add_documents(docs)
        vs.save_local(_FAISS_INDEX_DIR)
    else:
        embeddings = _get_embeddings()
        _vectorstore = FAISS.from_documents(docs, embeddings)
        _vectorstore.save_local(_FAISS_INDEX_DIR)

    logger.info(f"KB incremental: +{len(docs)} chunks from {schema}.{table}")
    return len(docs)


# ---------------------------------------------------------------------------
# Auto-sync daemon (runs every 4 minutes in background thread)
# ---------------------------------------------------------------------------

def start_auto_sync():
    """Start the background auto-sync thread (4-min interval)."""
    global _sync_thread, _sync_running
    if _sync_running:
        return
    _sync_running = True

    def _sync_loop():
        global _sync_running
        logger.info(f"KB auto-sync started (interval={SYNC_INTERVAL_SECONDS}s)")
        while _sync_running:
            try:
                full_sync()
            except Exception as e:
                logger.error(f"KB auto-sync error: {e}", exc_info=True)
            time.sleep(SYNC_INTERVAL_SECONDS)

    _sync_thread = threading.Thread(target=_sync_loop, daemon=True, name="kb-auto-sync")
    _sync_thread.start()


def stop_auto_sync():
    """Stop the background auto-sync thread."""
    global _sync_running
    _sync_running = False


# ---------------------------------------------------------------------------
# Build / Load / Search (backward-compatible API)
# ---------------------------------------------------------------------------

def build_index_from_local_files(doc_dir: str) -> FAISS:
    """Build FAISS index from local files + Supabase data."""
    os.environ.setdefault("DOC_DIR", doc_dir)
    result = full_sync()
    logger.info(f"build_index_from_local_files: {result}")
    return _vectorstore


def load_index() -> Optional[FAISS]:
    """Load FAISS index from disk."""
    global _vectorstore
    if _vectorstore is not None:
        return _vectorstore
    index_path = Path(_FAISS_INDEX_DIR)
    if (index_path / "index.faiss").exists():
        embeddings = _get_embeddings()
        _vectorstore = FAISS.load_local(
            _FAISS_INDEX_DIR, embeddings, allow_dangerous_deserialization=True
        )
        logger.info("FAISS index loaded from disk")
        return _vectorstore
    return None


def get_vectorstore() -> Optional[FAISS]:
    """Get the current vectorstore (load if needed)."""
    global _vectorstore
    if _vectorstore is None:
        load_index()
    return _vectorstore


def search_kb(query: str, k: int = 5) -> list[dict]:
    """Search the knowledge base and return results with scores."""
    vs = get_vectorstore()
    if vs is None:
        return [{"content": "Knowledge base not initialized. Run full_sync first.", "metadata": {}}]
    results = vs.similarity_search_with_score(query, k=k)
    return [
        {"content": doc.page_content[:1500], "metadata": doc.metadata, "score": float(score)}
        for doc, score in results
    ]


def get_sync_stats() -> dict:
    """Return current sync statistics."""
    return {**_sync_stats, "sync_running": _sync_running, "last_sync_at": _last_sync_at}


# ---------------------------------------------------------------------------
# Legacy compatibility
# ---------------------------------------------------------------------------

def sync_from_supabase() -> int:
    """Legacy API — now delegates to full_sync."""
    result = full_sync()
    return result.get("chunks", 0)


def add_file_to_kb(file_path: str, source_name: str) -> int:
    """Index a new file and add it to the existing FAISS index."""
    global _vectorstore
    docs = _excel_to_documents(file_path, source_name)
    if not docs:
        return 0
    vs = get_vectorstore()
    if vs is not None:
        vs.add_documents(docs)
        vs.save_local(_FAISS_INDEX_DIR)
    else:
        embeddings = _get_embeddings()
        _vectorstore = FAISS.from_documents(docs, embeddings)
        _vectorstore.save_local(_FAISS_INDEX_DIR)
    logger.info(f"Added {len(docs)} chunks from {source_name}")
    return len(docs)
