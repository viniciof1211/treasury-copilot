"""
CDC Poller — polls PcGraf SQL Server every N seconds for changes.
Detects inserts/updates via three strategies:
  1. checksum — hash all rows, compare with last known hash
  2. timestamp — track max date column, fetch rows newer than watermark
  3. pk_max — track max PK value, fetch rows with PK > watermark

On change detection:
  - Double-commit: write to Supabase tms.cdc_events + canonical table
  - Publish to Kafka topic (one topic per SQL table)
"""

import hashlib
import json
import logging
import time
import decimal
import datetime
from typing import Any

import pymssql

from .config import (
    PCGRAF_HOST, PCGRAF_USER, PCGRAF_PASS, PCGRAF_DB,
    SUPABASE_URL, SUPABASE_KEY,
    BATCH_SIZE, MAX_ROWS_PER_TABLE, CDC_TABLES,
)

import os
SUPABASE_SCHEMA = os.environ.get("CDC_SUPABASE_SCHEMA", "public")

logger = logging.getLogger("cdc.poller")


def _serialize_row(row: dict) -> dict:
    """Convert SQL Server row values to JSON-safe types."""
    clean = {}
    for k, v in row.items():
        if isinstance(v, (datetime.datetime, datetime.date)):
            clean[k] = v.isoformat()
        elif isinstance(v, decimal.Decimal):
            clean[k] = float(v)
        elif isinstance(v, bytes):
            clean[k] = v.hex()[:40]
        elif isinstance(v, str):
            clean[k] = v.strip()
        else:
            clean[k] = v
    return clean


def _row_pk(row: dict, pk_cols: list[str]) -> str:
    """Build a composite PK string from a row."""
    if not pk_cols or pk_cols == [""]:
        return hashlib.md5(json.dumps(row, default=str, sort_keys=True).encode()).hexdigest()[:16]
    parts = []
    for col in pk_cols:
        val = row.get(col, row.get(col.strip(), ""))
        parts.append(str(val).strip() if val is not None else "")
    return "|".join(parts)


def _row_hash(row: dict) -> str:
    """Compute a hash of a row for change detection."""
    return hashlib.md5(json.dumps(row, default=str, sort_keys=True).encode()).hexdigest()


class Watermark:
    """In-memory watermark state per table (persisted to Supabase between runs)."""
    def __init__(self):
        self.last_poll_at: str | None = None
        self.last_row_hash: str | None = None
        self.last_max_pk: str | None = None
        self.last_max_date: str | None = None
        self.rows_synced: int = 0
        self.known_hashes: dict[str, str] = {}  # pk -> row_hash


class CDCPoller:
    """Polls PcGraf for changes and emits CDC events."""

    def __init__(self, kafka_producer=None):
        self.watermarks: dict[str, Watermark] = {}
        self.kafka_producer = kafka_producer
        self._supabase_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Prefer": "return=minimal",
        }
        if SUPABASE_SCHEMA != "public":
            self._supabase_headers["Accept-Profile"] = SUPABASE_SCHEMA
            self._supabase_headers["Content-Profile"] = SUPABASE_SCHEMA

    def _connect_pcgraf(self) -> pymssql.Connection:
        return pymssql.connect(
            server=PCGRAF_HOST,
            user=PCGRAF_USER,
            password=PCGRAF_PASS,
            database=PCGRAF_DB,
            as_dict=True,
        )

    def _get_watermark(self, table: str) -> Watermark:
        if table not in self.watermarks:
            self.watermarks[table] = Watermark()
        return self.watermarks[table]

    # ── Polling strategies ─────────────────────────────────────────────────

    def _poll_checksum(self, conn, table: str, cfg: dict) -> list[dict]:
        """Full-table checksum comparison. Good for small/medium master tables."""
        cursor = conn.cursor(as_dict=True)
        pk_cols = [c.strip() for c in cfg["pk"].split(",") if c.strip()]
        wm = self._get_watermark(table)

        cursor.execute(f"SELECT TOP {MAX_ROWS_PER_TABLE} * FROM [{table}]")
        rows = cursor.fetchall()
        changes = []

        for raw_row in rows:
            row = _serialize_row(raw_row)
            pk = _row_pk(row, pk_cols)
            rh = _row_hash(row)

            if pk in wm.known_hashes:
                if wm.known_hashes[pk] != rh:
                    changes.append({"type": "UPDATE", "pk": pk, "data": row})
                    wm.known_hashes[pk] = rh
            else:
                changes.append({"type": "INSERT", "pk": pk, "data": row})
                wm.known_hashes[pk] = rh

        wm.last_poll_at = datetime.datetime.utcnow().isoformat()
        wm.rows_synced = len(rows)
        return changes

    def _poll_timestamp(self, conn, table: str, cfg: dict) -> list[dict]:
        """Fetch rows newer than the last known max date."""
        cursor = conn.cursor(as_dict=True)
        pk_cols = [c.strip() for c in cfg["pk"].split(",") if c.strip()]
        date_col = cfg["date_col"]
        wm = self._get_watermark(table)

        if wm.last_max_date:
            sql = f"SELECT TOP {BATCH_SIZE} * FROM [{table}] WHERE [{date_col}] > %s ORDER BY [{date_col}]"
            cursor.execute(sql, (wm.last_max_date,))
        else:
            sql = f"SELECT TOP {BATCH_SIZE} * FROM [{table}] ORDER BY [{date_col}] DESC"
            cursor.execute(sql)

        rows = cursor.fetchall()
        changes = []

        for raw_row in rows:
            row = _serialize_row(raw_row)
            pk = _row_pk(row, pk_cols)
            date_val = row.get(date_col)
            changes.append({"type": "INSERT", "pk": pk, "data": row})
            if date_val and (not wm.last_max_date or str(date_val) > str(wm.last_max_date)):
                wm.last_max_date = str(date_val)

        wm.last_poll_at = datetime.datetime.utcnow().isoformat()
        wm.rows_synced += len(rows)
        return changes

    def _poll_pk_max(self, conn, table: str, cfg: dict) -> list[dict]:
        """Fetch rows with PK > last known max. Good for append-only tables."""
        cursor = conn.cursor(as_dict=True)
        pk_cols = [c.strip() for c in cfg["pk"].split(",") if c.strip()]
        wm = self._get_watermark(table)

        if not pk_cols or pk_cols == [""]:
            return self._poll_checksum(conn, table, cfg)

        first_pk = pk_cols[0]
        if wm.last_max_pk:
            sql = f"SELECT TOP {BATCH_SIZE} * FROM [{table}] WHERE [{first_pk}] > %s ORDER BY [{first_pk}]"
            cursor.execute(sql, (wm.last_max_pk,))
        else:
            sql = f"SELECT TOP {BATCH_SIZE} * FROM [{table}] ORDER BY [{first_pk}] DESC"
            cursor.execute(sql)

        rows = cursor.fetchall()
        changes = []

        for raw_row in rows:
            row = _serialize_row(raw_row)
            pk = _row_pk(row, pk_cols)
            pk_val = str(row.get(first_pk, "")).strip()
            changes.append({"type": "INSERT", "pk": pk, "data": row})
            if pk_val and (not wm.last_max_pk or pk_val > wm.last_max_pk):
                wm.last_max_pk = pk_val

        wm.last_poll_at = datetime.datetime.utcnow().isoformat()
        wm.rows_synced += len(rows)
        return changes

    # ── Commit to Supabase ─────────────────────────────────────────────────

    def _commit_to_supabase(self, table: str, events: list[dict]) -> int:
        """Write CDC events to tms.cdc_events table in Supabase."""
        if not SUPABASE_URL or not SUPABASE_KEY or not events:
            return 0
        import httpx
        rows = []
        for ev in events:
            rows.append({
                "sql_table_name": table,
                "event_type": ev["type"],
                "row_pk": ev["pk"],
                "new_data": ev["data"],
                "committed_to_supabase": True,
                "committed_to_kafka": self.kafka_producer is not None,
                "kafka_topic": f"siawin0.{table}",
            })
        try:
            # Batch insert in chunks of 500
            committed = 0
            for i in range(0, len(rows), 500):
                batch = rows[i:i+500]
                resp = httpx.post(
                    f"{SUPABASE_URL}/rest/v1/cdc_events",
                    json=batch,
                    headers=self._supabase_headers,
                    timeout=30.0,
                )
                if resp.status_code in (200, 201):
                    committed += len(batch)
                else:
                    logger.error(f"Supabase cdc_events insert error: {resp.status_code} {resp.text[:200]}")
            return committed
        except Exception as e:
            logger.error(f"Supabase commit error for {table}: {e}")
            return 0

    # ── Publish to Kafka ───────────────────────────────────────────────────

    def _publish_to_kafka(self, table: str, events: list[dict]) -> int:
        """Publish CDC events to Kafka topic."""
        if not self.kafka_producer or not events:
            return 0
        topic = f"siawin0.{table}"
        published = 0
        for ev in events:
            try:
                msg = json.dumps({
                    "table": table,
                    "type": ev["type"],
                    "pk": ev["pk"],
                    "data": ev["data"],
                    "ts": datetime.datetime.utcnow().isoformat(),
                }, default=str).encode("utf-8")
                self.kafka_producer.send(topic, value=msg)
                published += 1
            except Exception as e:
                logger.error(f"Kafka publish error for {table}/{ev['pk']}: {e}")
        if published > 0:
            try:
                self.kafka_producer.flush(timeout=10)
            except Exception:
                pass
        return published

    # ── Notify FAISS KB to refresh ───────────────────────────────────────

    def _notify_kb_refresh(self, table: str, events: list[dict]) -> int:
        """Notify the FAISS Knowledge Base to ingest new CDC data.
        Tries in-process first (if running in same process as server),
        then falls back to HTTP POST to /kb/cdc_refresh."""
        if not events:
            return 0
        # Try in-process incremental sync first
        try:
            from agent.knowledge_base import incremental_sync as kb_incremental
            rows = [ev["data"] for ev in events[:500]]  # Cap at 500 rows
            count = kb_incremental(table, "tms", rows)
            logger.info(f"  KB in-process refresh: +{count} chunks for {table}")
            return count
        except ImportError:
            pass
        except Exception as e:
            logger.debug(f"  KB in-process refresh failed: {e}")

        # Fallback: HTTP POST to agent server
        if not SUPABASE_URL:
            return 0
        try:
            import httpx
            # Try the local agent server or Modal deployment
            for base_url in ["http://localhost:8000", "https://levinnovation--treasury-copilot-agent-web.modal.run"]:
                try:
                    rows = [ev["data"] for ev in events[:200]]
                    resp = httpx.post(
                        f"{base_url}/kb/cdc_refresh",
                        json={"table": table, "schema": "tms", "rows": rows},
                        timeout=15.0,
                    )
                    if resp.status_code in (200, 201):
                        result = resp.json()
                        logger.info(f"  KB HTTP refresh ({base_url}): {result}")
                        return result.get("chunks_added", 0)
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"  KB HTTP refresh failed: {e}")
        return 0

    # ── Update watermark in Supabase ───────────────────────────────────────

    def _update_watermark_supabase(self, table: str):
        """Persist watermark state to Supabase tms.cdc_watermarks."""
        if not SUPABASE_URL or not SUPABASE_KEY:
            return
        wm = self._get_watermark(table)
        import httpx
        try:
            payload = {
                "sql_table_name": table,
                "last_poll_at": wm.last_poll_at or datetime.datetime.utcnow().isoformat(),
                "last_max_pk": wm.last_max_pk,
                "last_max_date": wm.last_max_date,
                "rows_synced": wm.rows_synced,
                "status": "idle",
                "updated_at": datetime.datetime.utcnow().isoformat(),
            }
            # Upsert
            headers = {**self._supabase_headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
            httpx.post(
                f"{SUPABASE_URL}/rest/v1/cdc_watermarks",
                json=payload,
                headers=headers,
                timeout=10.0,
            )
        except Exception as e:
            logger.error(f"Watermark update error for {table}: {e}")

    # ── Main poll cycle ────────────────────────────────────────────────────

    def poll_table(self, table: str, cfg: dict) -> dict[str, Any]:
        """Poll a single table for changes and commit."""
        strategy = cfg.get("strategy", "checksum")
        logger.info(f"Polling {table} (strategy={strategy})...")

        try:
            conn = self._connect_pcgraf()
        except Exception as e:
            logger.error(f"Cannot connect to PcGraf: {e}")
            return {"table": table, "error": str(e), "changes": 0}

        try:
            if strategy == "checksum":
                events = self._poll_checksum(conn, table, cfg)
            elif strategy == "timestamp":
                events = self._poll_timestamp(conn, table, cfg)
            elif strategy == "pk_max":
                events = self._poll_pk_max(conn, table, cfg)
            else:
                events = self._poll_checksum(conn, table, cfg)
        except Exception as e:
            logger.error(f"Poll error for {table}: {e}")
            conn.close()
            return {"table": table, "error": str(e), "changes": 0}

        conn.close()

        if not events:
            logger.info(f"  {table}: no changes detected")
            self._update_watermark_supabase(table)
            return {"table": table, "changes": 0}

        logger.info(f"  {table}: {len(events)} changes detected")

        # Double commit
        sb_count = self._commit_to_supabase(table, events)
        kf_count = self._publish_to_kafka(table, events)
        self._update_watermark_supabase(table)

        # Triple commit: notify FAISS KB to refresh with new data
        kb_count = self._notify_kb_refresh(table, events)

        return {
            "table": table,
            "changes": len(events),
            "committed_supabase": sb_count,
            "published_kafka": kf_count,
            "kb_refreshed": kb_count,
        }

    def poll_all(self) -> list[dict]:
        """Poll all configured tables."""
        results = []
        for table, cfg in CDC_TABLES.items():
            result = self.poll_table(table, cfg)
            results.append(result)
        return results
