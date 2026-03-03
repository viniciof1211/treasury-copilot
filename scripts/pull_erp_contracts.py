"""
Pull contract documents from PcGraf ERP (CEM0.dbo.IM00) and export them as files.

Usage:
    python scripts/pull_erp_contracts.py                      # Export all PDFs
    python scripts/pull_erp_contracts.py --proyecto 21017     # Export docs for a specific project
    python scripts/pull_erp_contracts.py --limit 50           # Export first 50 docs
    python scripts/pull_erp_contracts.py --ext .pdf           # Only PDFs
    python scripts/pull_erp_contracts.py --output ./exports   # Custom output directory
    python scripts/pull_erp_contracts.py --list-only          # Just list docs, don't download

ERP SQL Server:  192.168.1.3 (CEM0 catalog)
SQL Login:       vflores / Master2025
Windows Server:  192.168.1.2 (Administrador / Sp4rt4c02010)

Schema:
    IM00 — IDLinea (PK), CodProyecto (FK→HO00), NombreDocumento, Extension,
           Data (image blob), FileName, QuienIngreso, FechaIngreso, Observaciones
    HO00 — IdLinea (PK), Descripcion (project name), CodCliente
"""

import argparse
import os
import sys
import re
import logging
from pathlib import Path
from datetime import datetime

try:
    import pymssql
except ImportError:
    print("ERROR: pymssql is required. Install with: pip install pymssql")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SQL_SERVER = os.getenv("PCGRAF_SQL_SERVER", "192.168.1.3")
SQL_USER = os.getenv("PCGRAF_SQL_USER", "vflores")
SQL_PASSWORD = os.getenv("PCGRAF_SQL_PASSWORD", "Master2025")
SQL_DATABASE = "CEM0"

# Windows server credentials (for remote file operations if needed)
WIN_SERVER = "192.168.1.2"
WIN_USER = "Administrador"
WIN_PASSWORD = "Sp4rt4c02010"

DEFAULT_OUTPUT = os.path.join(os.path.dirname(__file__), "..", "exports", "contratos")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pull_contracts")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def connect(as_dict: bool = True):
    """Connect to CEM0 catalog on PcGraf SQL Server."""
    log.info(f"Connecting to {SQL_SERVER}/{SQL_DATABASE} as {SQL_USER}...")
    return pymssql.connect(
        server=SQL_SERVER,
        user=SQL_USER,
        password=SQL_PASSWORD,
        database=SQL_DATABASE,
        login_timeout=15,
        timeout=120,
        as_dict=as_dict,
    )


def safe_filename(name: str, max_len: int = 120) -> str:
    """Sanitize a string for use as a filename."""
    name = name.strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    name = re.sub(r'_+', '_', name)
    return name[:max_len].strip('_. ')


# ---------------------------------------------------------------------------
# List documents
# ---------------------------------------------------------------------------
def list_documents(conn, proyecto=None, ext=None, limit=None, offset=0):
    """Query IM00 joined with HO00 for document metadata (no blob)."""
    where_parts = ["1=1"]
    if proyecto:
        where_parts.append(f"i.CodProyecto = {int(proyecto)}")
    if ext:
        safe_ext = ext.replace("'", "''").lower()
        where_parts.append(f"RTRIM(LOWER(i.Extension)) = '{safe_ext}'")
    where = " AND ".join(where_parts)

    top_clause = f"TOP {int(limit)}" if limit else ""

    sql = f"""
        SELECT {top_clause}
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
            RTRIM(h.CodCliente) AS proyecto_cliente
        FROM IM00 i
        LEFT JOIN HO00 h ON h.IdLinea = i.CodProyecto
        WHERE {where}
        ORDER BY i.IDLinea DESC
    """
    cursor = conn.cursor()
    cursor.execute(sql)
    return cursor.fetchall()


# ---------------------------------------------------------------------------
# Fetch single document blob
# ---------------------------------------------------------------------------
def fetch_blob(conn, id_linea: int) -> tuple[bytes | None, str, str]:
    """Fetch the raw Data blob for a given IDLinea. Returns (blob, ext, nombre)."""
    cursor = conn.cursor(as_dict=False)
    cursor.execute(
        "SELECT [Data], RTRIM([Extension]), RTRIM([NombreDocumento]) "
        "FROM IM00 WHERE IDLinea = %s",
        (id_linea,),
    )
    row = cursor.fetchone()
    if not row or not row[0]:
        return None, "", ""
    return bytes(row[0]), (row[1] or "").strip(), (row[2] or f"doc_{id_linea}").strip()


# ---------------------------------------------------------------------------
# Export documents to disk
# ---------------------------------------------------------------------------
def export_documents(docs, conn, output_dir: str):
    """Download blobs and save as files organized by project."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    total = len(docs)
    exported = 0
    skipped = 0
    errors = 0

    log.info(f"Exporting {total} documents to {output_path.resolve()}")

    for i, doc in enumerate(docs, 1):
        id_linea = doc["IDLinea"]
        cod_proyecto = doc["CodProyecto"] or 0
        nombre = doc["nombre_documento"] or f"doc_{id_linea}"
        ext = (doc["extension"] or "").strip()
        data_size = doc["data_size"] or 0
        has_file = doc["has_file"]
        proyecto_nombre = doc["proyecto_nombre"] or f"proyecto_{cod_proyecto}"

        if not has_file:
            log.debug(f"  [{i}/{total}] #{id_linea} — no data, skipping")
            skipped += 1
            continue

        # Create project subfolder
        folder_name = safe_filename(f"{cod_proyecto}_{proyecto_nombre}")
        proj_dir = output_path / folder_name
        proj_dir.mkdir(parents=True, exist_ok=True)

        # Build filename
        fname = safe_filename(nombre)
        if ext and not fname.lower().endswith(ext.lower()):
            fname = f"{fname}{ext}"
        if not fname:
            fname = f"doc_{id_linea}{ext or '.bin'}"

        file_path = proj_dir / fname

        # Skip if already exists and same size
        if file_path.exists() and file_path.stat().st_size == data_size:
            log.debug(f"  [{i}/{total}] #{id_linea} — already exists, skipping")
            skipped += 1
            continue

        try:
            blob, _, _ = fetch_blob(conn, id_linea)
            if not blob:
                log.warning(f"  [{i}/{total}] #{id_linea} — empty blob")
                skipped += 1
                continue

            file_path.write_bytes(blob)
            exported += 1
            size_kb = len(blob) / 1024
            log.info(f"  [{i}/{total}] #{id_linea} → {file_path.name} ({size_kb:.1f} KB)")

        except Exception as e:
            log.error(f"  [{i}/{total}] #{id_linea} — ERROR: {e}")
            errors += 1

    log.info(f"\nDone: {exported} exported, {skipped} skipped, {errors} errors (of {total} total)")
    return exported, skipped, errors


# ---------------------------------------------------------------------------
# Print summary table
# ---------------------------------------------------------------------------
def print_summary(docs):
    """Print a summary table of documents."""
    print(f"\n{'ID':>8}  {'Proyecto':>8}  {'Nombre Documento':<45}  {'Ext':<8}  {'Tamaño':>10}  {'Subido por':<15}  {'Fecha':<12}  {'Proyecto Nombre':<30}")
    print("-" * 170)
    for doc in docs:
        dt = doc["fecha_ingreso"]
        fecha = dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)[:10] if dt else ""
        size = doc["data_size"] or 0
        size_str = f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/(1024*1024):.1f} MB"
        print(
            f"{doc['IDLinea']:>8}  "
            f"{doc['CodProyecto'] or 0:>8}  "
            f"{(doc['nombre_documento'] or '')[:45]:<45}  "
            f"{(doc['extension'] or ''):<8}  "
            f"{size_str:>10}  "
            f"{(doc['quien_ingreso'] or '')[:15]:<15}  "
            f"{fecha:<12}  "
            f"{(doc['proyecto_nombre'] or '')[:30]:<30}"
        )
    print(f"\nTotal: {len(docs)} documents")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
def print_stats(conn):
    """Print summary statistics about IM00."""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT CodProyecto) AS projects, "
        "SUM(CASE WHEN Data IS NOT NULL AND DATALENGTH(Data)>0 THEN 1 ELSE 0 END) AS with_data, "
        "SUM(CAST(DATALENGTH(Data) AS BIGINT)) AS total_bytes "
        "FROM IM00"
    )
    row = cursor.fetchone()
    total_gb = (row["total_bytes"] or 0) / (1024**3)
    print(f"\n📊 CEM0.dbo.IM00 Stats:")
    print(f"   Total documents:  {row['total']:,}")
    print(f"   Distinct projects: {row['projects']:,}")
    print(f"   With file data:   {row['with_data']:,}")
    print(f"   Total blob size:  {total_gb:.2f} GB")

    cursor.execute(
        "SELECT RTRIM(Extension) AS ext, COUNT(*) AS cnt "
        "FROM IM00 GROUP BY RTRIM(Extension) ORDER BY cnt DESC"
    )
    exts = cursor.fetchall()
    print(f"\n   Extensions:")
    for e in exts[:10]:
        print(f"     {e['ext'] or '(none)':<12} {e['cnt']:>6,}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Pull contract documents from PcGraf ERP (CEM0.dbo.IM00)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--proyecto", type=int, help="Filter by CodProyecto (project ID)")
    parser.add_argument("--ext", type=str, help="Filter by extension (e.g. .pdf, .jpg)")
    parser.add_argument("--limit", type=int, help="Max documents to process")
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT, help="Output directory")
    parser.add_argument("--list-only", action="store_true", help="List documents without downloading")
    parser.add_argument("--stats", action="store_true", help="Show table statistics")
    parser.add_argument("--server", type=str, default=SQL_SERVER, help="SQL Server address")
    parser.add_argument("--user", type=str, default=SQL_USER, help="SQL login username")
    parser.add_argument("--password", type=str, default=SQL_PASSWORD, help="SQL login password")
    args = parser.parse_args()

    conn = pymssql.connect(
        server=args.server,
        user=args.user,
        password=args.password,
        database=SQL_DATABASE,
        login_timeout=15,
        timeout=120,
        as_dict=True,
    )
    log.info(f"Connected to {args.server}/{SQL_DATABASE} as {args.user}")

    try:
        if args.stats:
            print_stats(conn)
            return

        docs = list_documents(conn, proyecto=args.proyecto, ext=args.ext, limit=args.limit)

        if not docs:
            log.info("No documents found matching the criteria.")
            return

        if args.list_only:
            print_summary(docs)
            return

        # Export
        exported, skipped, errors = export_documents(docs, conn, args.output)

        print(f"\n✅ Export complete:")
        print(f"   Output: {Path(args.output).resolve()}")
        print(f"   Exported: {exported}")
        print(f"   Skipped:  {skipped}")
        print(f"   Errors:   {errors}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
