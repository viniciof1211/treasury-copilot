"""FAISS-based Treasury Knowledge Base — indexes Excel files and syncs with Supabase."""

import os
import json
import logging
import tempfile
from pathlib import Path
from typing import Optional

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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")


def _get_embeddings() -> HuggingFaceEmbeddings:
    """Use sentence-transformers for local embeddings (no API key needed)."""
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Excel → Documents
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

        # Clean column names
        df.columns = [str(c).strip() for c in df.columns]

        # Chunk rows into groups of 20 for better retrieval granularity
        chunk_size = 20
        for start in range(0, len(df), chunk_size):
            chunk = df.iloc[start : start + chunk_size]
            # Build text representation
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
            metadata = {
                "source": source_name,
                "sheet": sheet_name,
                "row_start": start + 1,
                "row_end": start + len(chunk),
                "type": "excel_data",
            }
            docs.append(Document(page_content=text, metadata=metadata))

    return docs


# ---------------------------------------------------------------------------
# Build / Load Index
# ---------------------------------------------------------------------------

def build_index_from_local_files(doc_dir: str) -> FAISS:
    """Build FAISS index from all Excel files in a directory."""
    global _vectorstore
    all_docs: list[Document] = []

    doc_path = Path(doc_dir)
    for f in doc_path.glob("*.xlsx"):
        logger.info(f"Indexing {f.name}...")
        docs = _excel_to_documents(str(f), f.name)
        all_docs.extend(docs)
        logger.info(f"  → {len(docs)} chunks from {f.name}")

    # Also index .docx files as plain text metadata
    for f in doc_path.glob("*.docx"):
        try:
            # Simple text extraction from docx
            import zipfile
            import xml.etree.ElementTree as ET

            with zipfile.ZipFile(str(f)) as z:
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
                        # Chunk into ~500 char segments
                        full_text = "\n".join(text_parts)
                        for i in range(0, len(full_text), 500):
                            chunk = full_text[i : i + 500]
                            all_docs.append(
                                Document(
                                    page_content=chunk,
                                    metadata={"source": f.name, "type": "docx_text"},
                                )
                            )
                        logger.info(f"  → {len(text_parts)} paragraphs from {f.name}")
        except Exception as e:
            logger.warning(f"Cannot read {f.name}: {e}")

    # Also index the PROCESS_SUMMARY.md if it exists
    summary_file = doc_path / "PROCESS_SUMMARY.md"
    if summary_file.exists():
        text = summary_file.read_text(encoding="utf-8")
        for i in range(0, len(text), 500):
            chunk = text[i : i + 500]
            all_docs.append(
                Document(
                    page_content=chunk,
                    metadata={"source": "PROCESS_SUMMARY.md", "type": "markdown"},
                )
            )

    if not all_docs:
        logger.warning("No documents found to index!")
        # Create a minimal index with a placeholder
        all_docs = [Document(page_content="Treasury Knowledge Base — no documents indexed yet.", metadata={"source": "system"})]

    logger.info(f"Building FAISS index with {len(all_docs)} chunks...")
    embeddings = _get_embeddings()
    _vectorstore = FAISS.from_documents(all_docs, embeddings)

    # Save to disk
    os.makedirs(_FAISS_INDEX_DIR, exist_ok=True)
    _vectorstore.save_local(_FAISS_INDEX_DIR)
    logger.info(f"FAISS index saved to {_FAISS_INDEX_DIR}")

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


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def search_kb(query: str, k: int = 5) -> list[dict]:
    """Search the knowledge base and return results."""
    vs = get_vectorstore()
    if vs is None:
        return [{"content": "Knowledge base not initialized. Run build_index first.", "metadata": {}}]

    results = vs.similarity_search_with_score(query, k=k)
    return [
        {
            "content": doc.page_content[:1000],
            "metadata": doc.metadata,
            "score": float(score),
        }
        for doc, score in results
    ]


# ---------------------------------------------------------------------------
# Supabase Sync — pull data from Supabase tables into KB
# ---------------------------------------------------------------------------

def sync_from_supabase() -> int:
    """Pull latest data from Supabase silver_finance tables and add to FAISS index."""
    global _vectorstore
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.warning("Supabase credentials not configured, skipping sync")
        return 0

    headers = _supabase_headers()
    new_docs: list[Document] = []

    # Sync CxP items
    try:
        resp = httpx.post(
            f"{SUPABASE_URL}/functions/v1/treasury-tools",
            json={"tool": "query_sql", "params": {"sql": "SELECT * FROM silver_finance.cxp_items ORDER BY created_at DESC LIMIT 500"}},
            headers=headers,
            timeout=30.0,
        )
        if resp.status_code == 200:
            rows = resp.json().get("rows", [])
            for i in range(0, len(rows), 20):
                chunk = rows[i : i + 20]
                text = "CxP Items (Cuentas por Pagar):\n"
                for r in chunk:
                    parts = [f"{k}: {v}" for k, v in r.items() if v is not None and str(v).strip()]
                    text += " | ".join(parts) + "\n"
                new_docs.append(Document(
                    page_content=text,
                    metadata={"source": "supabase_sync", "table": "cxp_items", "type": "db_sync"},
                ))
            logger.info(f"Synced {len(rows)} CxP items")
    except Exception as e:
        logger.error(f"CxP sync error: {e}")

    # Sync Flujo Semanal
    try:
        resp = httpx.post(
            f"{SUPABASE_URL}/functions/v1/treasury-tools",
            json={"tool": "query_sql", "params": {"sql": "SELECT * FROM silver_finance.flujo_semanal ORDER BY created_at DESC LIMIT 500"}},
            headers=headers,
            timeout=30.0,
        )
        if resp.status_code == 200:
            rows = resp.json().get("rows", [])
            for i in range(0, len(rows), 20):
                chunk = rows[i : i + 20]
                text = "Flujo Semanal (Operaciones Bancarias):\n"
                for r in chunk:
                    parts = [f"{k}: {v}" for k, v in r.items() if v is not None and str(v).strip()]
                    text += " | ".join(parts) + "\n"
                new_docs.append(Document(
                    page_content=text,
                    metadata={"source": "supabase_sync", "table": "flujo_semanal", "type": "db_sync"},
                ))
            logger.info(f"Synced {len(rows)} Flujo items")
    except Exception as e:
        logger.error(f"Flujo sync error: {e}")

    # Sync MRP
    try:
        resp = httpx.post(
            f"{SUPABASE_URL}/functions/v1/treasury-tools",
            json={"tool": "query_sql", "params": {"sql": "SELECT * FROM silver_finance.mrp_master ORDER BY created_at DESC LIMIT 200"}},
            headers=headers,
            timeout=30.0,
        )
        if resp.status_code == 200:
            rows = resp.json().get("rows", [])
            for i in range(0, len(rows), 20):
                chunk = rows[i : i + 20]
                text = "MRP Master (Planning de Compras):\n"
                for r in chunk:
                    parts = [f"{k}: {v}" for k, v in r.items() if v is not None and str(v).strip()]
                    text += " | ".join(parts) + "\n"
                new_docs.append(Document(
                    page_content=text,
                    metadata={"source": "supabase_sync", "table": "mrp_master", "type": "db_sync"},
                ))
            logger.info(f"Synced {len(rows)} MRP items")
    except Exception as e:
        logger.error(f"MRP sync error: {e}")

    if new_docs:
        vs = get_vectorstore()
        if vs is not None:
            vs.add_documents(new_docs)
            vs.save_local(_FAISS_INDEX_DIR)
            logger.info(f"Added {len(new_docs)} chunks from Supabase sync")
        else:
            embeddings = _get_embeddings()
            _vectorstore = FAISS.from_documents(new_docs, embeddings)
            _vectorstore.save_local(_FAISS_INDEX_DIR)
            logger.info(f"Created new index with {len(new_docs)} chunks from Supabase sync")

    return len(new_docs)


# ---------------------------------------------------------------------------
# Add new file to KB
# ---------------------------------------------------------------------------

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
