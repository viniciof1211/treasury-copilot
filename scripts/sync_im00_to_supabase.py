"""
Continuous sync service: PcGraf CEM0.dbo.IM00 → Supabase Storage + tms.im00_documents

Runs on the Windows server (192.168.1.2) where the PcGraf SQL Server is reachable.
Picks up new and updated documents from IM00, uploads blobs to Supabase Storage
bucket 'contract-documents', and upserts metadata into tms.im00_documents.

Usage:
    # Run once (sync all missing docs then exit):
    python scripts/sync_im00_to_supabase.py --once

    # Run as continuous daemon (default: poll every 5 minutes):
    python scripts/sync_im00_to_supabase.py

    # Custom interval:
    python scripts/sync_im00_to_supabase.py --interval 120

    # Limit batch size per cycle:
    python scripts/sync_im00_to_supabase.py --batch 200

    # Dry run (list what would be synced):
    python scripts/sync_im00_to_supabase.py --dry-run

Environment variables (or defaults):
    PCGRAF_SQL_SERVER   = 192.168.1.3
    PCGRAF_SQL_USER     = vflores
    PCGRAF_SQL_PASSWORD = Master2025
    SUPABASE_URL        = https://aanhzgezgyawitpvwrcw.supabase.co
    SUPABASE_SERVICE_ROLE_KEY = (your service role key)
"""

import argparse
import os
import sys
import time
import re
import logging
from datetime import datetime, timezone

try:
    import pymssql
except ImportError:
    print("ERROR: pymssql required. pip install pymssql")
    sys.exit(1)

try:
    import httpx
except ImportError:
    print("ERROR: httpx required. pip install httpx")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SQL_SERVER = os.getenv("PCGRAF_SQL_SERVER", "192.168.1.3")
SQL_USER = os.getenv("PCGRAF_SQL_USER", "vflores")
SQL_PASSWORD = os.getenv("PCGRAF_SQL_PASSWORD", "Master2025")
SQL_DATABASE = "CEM0"

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://aanhzgezgyawitpvwrcw.supabase.co")
SUPABASE_KEY = os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmh6Z2V6Z3lhd2l0cHZ3cmN3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQzNTgwOSwiZXhwIjoyMDg2MDExODA5fQ.o6wKGEj0AlMKJ717VeCt0I2DkU-jbJd2lW65ZkzUqWY",
)

BUCKET = "contract-documents"

EXT_CONTENT_TYPE: dict[str, str] = {
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_im00")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_path(name: str) -> str:
    """Sanitize a string for use in a Supabase storage path (ASCII-only)."""
    import unicodedata
    name = name.strip()
    # Transliterate accented/special chars to ASCII (ñ→n, á→a, etc.)
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r'[<>:"|?*\x00-\x1f]', '_', name)
    name = re.sub(r'[^\w.\- ]', '_', name)
    name = re.sub(r'_+', '_', name)
    return name[:120]


def detect_content_type(ext: str, data: bytes) -> str:
    """Determine content type from extension or magic bytes."""
    ct = EXT_CONTENT_TYPE.get(ext, "")
    if ct:
        return ct
    if data[:4] == b'%PDF':
        return "application/pdf"
    if data[:4] == b'\x89PNG':
        return "image/png"
    if data[:2] == b'\xff\xd8':
        return "image/jpeg"
    if data[:2] == b'PK':
        return "application/zip"
    return "application/octet-stream"


def supabase_headers(content_type: str = "application/json") -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": content_type,
    }


def supabase_rest_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Content-Profile": "tms",
        "Accept-Profile": "tms",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


# ---------------------------------------------------------------------------
# SQL Server — fetch documents not yet synced
# ---------------------------------------------------------------------------

def connect_sql():
    log.info(f"Connecting to SQL Server {SQL_SERVER}/{SQL_DATABASE}...")
    return pymssql.connect(
        server=SQL_SERVER,
        user=SQL_USER,
        password=SQL_PASSWORD,
        database=SQL_DATABASE,
        login_timeout=15,
        timeout=300,
        as_dict=True,
    )


def fetch_synced_ids(client: httpx.Client) -> set[int]:
    """Get all id_linea values already synced to Supabase."""
    synced: set[int] = set()
    offset = 0
    page_size = 1000
    while True:
        r = client.get(
            f"{SUPABASE_URL}/rest/v1/im00_documents",
            headers={
                **supabase_rest_headers(),
                "Content-Type": "application/json",
            },
            params={"select": "id_linea", "limit": str(page_size), "offset": str(offset)},
        )
        if r.status_code != 200:
            log.error(f"Failed to fetch synced IDs: {r.status_code} {r.text[:200]}")
            break
        rows = r.json()
        if not rows:
            break
        for row in rows:
            synced.add(row["id_linea"])
        offset += page_size
        if len(rows) < page_size:
            break
    return synced


def fetch_im00_batch(conn, exclude_ids: set[int], batch_size: int) -> list[dict]:
    """Fetch a batch of IM00 rows that have file data and aren't yet synced."""
    cursor = conn.cursor()

    # Build exclusion — use a chunked approach for large sets
    if exclude_ids:
        # Get all IM00 IDs with data, then filter in Python
        cursor.execute(
            "SELECT i.IDLinea, i.CodProyecto, "
            "RTRIM(i.NombreDocumento) AS NombreDocumento, "
            "RTRIM(i.Extension) AS Extension, "
            "RTRIM(i.FileName) AS FileName, "
            "RTRIM(i.Observaciones) AS Observaciones, "
            "i.Grupo, "
            "RTRIM(i.QuienIngreso) AS QuienIngreso, "
            "i.FechaIngreso, "
            "RTRIM(i.Supervisor) AS Supervisor, "
            "DATALENGTH(i.Data) AS DataSize, "
            "RTRIM(h.Descripcion) AS ProyectoNombre, "
            "RTRIM(h.CodCliente) AS ProyectoCliente "
            "FROM IM00 i "
            "LEFT JOIN HO00 h ON h.IdLinea = i.CodProyecto "
            "WHERE i.Data IS NOT NULL AND DATALENGTH(i.Data) > 0 "
            "ORDER BY i.IDLinea DESC"
        )
    else:
        cursor.execute(
            "SELECT i.IDLinea, i.CodProyecto, "
            "RTRIM(i.NombreDocumento) AS NombreDocumento, "
            "RTRIM(i.Extension) AS Extension, "
            "RTRIM(i.FileName) AS FileName, "
            "RTRIM(i.Observaciones) AS Observaciones, "
            "i.Grupo, "
            "RTRIM(i.QuienIngreso) AS QuienIngreso, "
            "i.FechaIngreso, "
            "RTRIM(i.Supervisor) AS Supervisor, "
            "DATALENGTH(i.Data) AS DataSize, "
            "RTRIM(h.Descripcion) AS ProyectoNombre, "
            "RTRIM(h.CodCliente) AS ProyectoCliente "
            "FROM IM00 i "
            "LEFT JOIN HO00 h ON h.IdLinea = i.CodProyecto "
            "WHERE i.Data IS NOT NULL AND DATALENGTH(i.Data) > 0 "
            "ORDER BY i.IDLinea DESC"
        )

    results = []
    for row in cursor:
        if row["IDLinea"] in exclude_ids:
            continue
        results.append(row)
        if len(results) >= batch_size:
            break

    return results


def fetch_blob(conn, id_linea: int) -> bytes | None:
    """Fetch the raw file blob for a specific document."""
    # Use raw cursor (not as_dict) for binary fidelity
    raw_conn = pymssql.connect(
        server=SQL_SERVER,
        user=SQL_USER,
        password=SQL_PASSWORD,
        database=SQL_DATABASE,
        login_timeout=15,
        timeout=120,
    )
    try:
        cursor = raw_conn.cursor()
        cursor.execute("SELECT [Data] FROM IM00 WHERE IDLinea = %s", (id_linea,))
        row = cursor.fetchone()
        if row and row[0]:
            return bytes(row[0])
        return None
    finally:
        raw_conn.close()


# ---------------------------------------------------------------------------
# Supabase — upload blob + upsert metadata
# ---------------------------------------------------------------------------

def upload_to_storage(client: httpx.Client, path: str, data: bytes, content_type: str) -> bool:
    """Upload a file to Supabase Storage. Returns True on success."""
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"

    # Try upload (POST), fall back to update (PUT) if exists
    r = client.post(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=data,
        timeout=120,
    )

    if r.status_code in (200, 201):
        return True

    # If the file already exists, update it
    if r.status_code == 400 and "already exists" in r.text.lower():
        r2 = client.put(
            url,
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": content_type,
            },
            content=data,
            timeout=120,
        )
        if r2.status_code == 200:
            return True
        log.error(f"Storage update failed: {r2.status_code} {r2.text[:200]}")
        return False

    log.error(f"Storage upload failed: {r.status_code} {r.text[:200]}")
    return False


def upsert_metadata(client: httpx.Client, doc: dict, storage_path: str, content_type: str) -> bool:
    """Upsert document metadata into tms.im00_documents via PostgREST."""
    fecha = doc.get("FechaIngreso")
    if fecha and isinstance(fecha, datetime):
        fecha = fecha.isoformat()
    elif fecha:
        fecha = str(fecha)

    payload = {
        "id_linea": doc["IDLinea"],
        "cod_proyecto": doc.get("CodProyecto"),
        "nombre_documento": doc.get("NombreDocumento") or f"doc_{doc['IDLinea']}",
        "extension": (doc.get("Extension") or "").strip().lower(),
        "file_name": doc.get("FileName") or "",
        "observaciones": doc.get("Observaciones") or "",
        "grupo": doc.get("Grupo"),
        "quien_ingreso": doc.get("QuienIngreso") or "",
        "fecha_ingreso": fecha,
        "supervisor": doc.get("Supervisor") or "",
        "data_size": doc.get("DataSize") or 0,
        "proyecto_nombre": doc.get("ProyectoNombre") or "",
        "proyecto_cliente": doc.get("ProyectoCliente") or "",
        "storage_path": storage_path,
        "content_type": content_type,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }

    r = client.post(
        f"{SUPABASE_URL}/rest/v1/im00_documents",
        headers=supabase_rest_headers(),
        json=payload,
    )

    if r.status_code in (200, 201, 204):
        return True

    log.error(f"Metadata upsert failed for {doc['IDLinea']}: {r.status_code} {r.text[:200]}")
    return False


# ---------------------------------------------------------------------------
# Sync cycle
# ---------------------------------------------------------------------------

def sync_cycle(batch_size: int, dry_run: bool = False) -> tuple[int, int]:
    """
    Run one sync cycle. Returns (synced_count, error_count).
    """
    synced = 0
    errors = 0

    with httpx.Client(timeout=30) as client:
        # 1. Get already-synced IDs
        log.info("Fetching synced document IDs from Supabase...")
        synced_ids = fetch_synced_ids(client)
        log.info(f"Already synced: {len(synced_ids)} documents")

        # 2. Get unsynced docs from SQL Server
        log.info("Querying IM00 for unsynced documents...")
        conn = connect_sql()
        try:
            docs = fetch_im00_batch(conn, synced_ids, batch_size)
        finally:
            conn.close()

        if not docs:
            log.info("No new documents to sync.")
            return 0, 0

        log.info(f"Found {len(docs)} new documents to sync")

        if dry_run:
            for d in docs[:20]:
                log.info(f"  [DRY] IDLinea={d['IDLinea']} {d.get('NombreDocumento', '?')} "
                         f"({d.get('Extension', '?')}) {d.get('DataSize', 0):,} bytes "
                         f"→ Proyecto: {d.get('ProyectoNombre', '?')}")
            if len(docs) > 20:
                log.info(f"  ... and {len(docs) - 20} more")
            return 0, 0

        # 3. Upload each document
        for i, doc in enumerate(docs, 1):
            id_linea = doc["IDLinea"]
            nombre = doc.get("NombreDocumento") or f"doc_{id_linea}"
            ext = (doc.get("Extension") or "").strip().lower()
            cod_proyecto = doc.get("CodProyecto") or 0

            # Build storage path: proyecto_<id>/<idlinea>_<name>
            safe_name = safe_path(nombre)
            # Only append extension if the name doesn't already end with it
            if ext and not safe_name.lower().endswith(ext):
                safe_name = f"{safe_name}{ext}"
            storage_path = f"proyecto_{cod_proyecto}/{id_linea}_{safe_name}"

            log.info(f"[{i}/{len(docs)}] Syncing IDLinea={id_linea}: {nombre}{ext} "
                     f"({doc.get('DataSize', 0):,} bytes) → {storage_path}")

            try:
                # Fetch blob from SQL Server
                blob = fetch_blob(conn if conn else None, id_linea)
                if not blob:
                    log.warning(f"  No blob data for IDLinea={id_linea}, skipping")
                    errors += 1
                    continue

                content_type = detect_content_type(ext, blob)

                # Upload to Supabase Storage
                if not upload_to_storage(client, storage_path, blob, content_type):
                    errors += 1
                    continue

                # Upsert metadata
                if not upsert_metadata(client, doc, storage_path, content_type):
                    errors += 1
                    continue

                synced += 1
                log.info(f"  ✓ Synced ({len(blob):,} bytes)")

            except Exception as e:
                log.error(f"  ✗ Error syncing IDLinea={id_linea}: {e}")
                errors += 1

    return synced, errors


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Sync IM00 documents from PcGraf to Supabase")
    parser.add_argument("--once", action="store_true", help="Run once then exit")
    parser.add_argument("--interval", type=int, default=300, help="Poll interval in seconds (default: 300)")
    parser.add_argument("--batch", type=int, default=500, help="Max documents per cycle (default: 500)")
    parser.add_argument("--dry-run", action="store_true", help="List what would be synced without uploading")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("IM00 → Supabase Sync Service")
    log.info(f"  SQL Server:   {SQL_SERVER}/{SQL_DATABASE}")
    log.info(f"  Supabase:     {SUPABASE_URL}")
    log.info(f"  Bucket:       {BUCKET}")
    log.info(f"  Batch size:   {args.batch}")
    log.info(f"  Interval:     {'once' if args.once else f'{args.interval}s'}")
    log.info(f"  Dry run:      {args.dry_run}")
    log.info("=" * 60)

    while True:
        try:
            t0 = time.time()
            synced, errors = sync_cycle(args.batch, args.dry_run)
            elapsed = time.time() - t0
            log.info(f"Cycle complete: {synced} synced, {errors} errors in {elapsed:.1f}s")
        except KeyboardInterrupt:
            log.info("Interrupted by user. Exiting.")
            break
        except Exception as e:
            log.error(f"Cycle failed: {e}")

        if args.once or args.dry_run:
            break

        log.info(f"Sleeping {args.interval}s until next cycle...")
        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            log.info("Interrupted during sleep. Exiting.")
            break


if __name__ == "__main__":
    main()
