"""
CDC Runner — main entry point that runs the polling loop every N seconds.
Usage:
    python -m cdc.runner              # poll all tables once
    python -m cdc.runner --daemon     # run continuously every 5 min
    python -m cdc.runner --table IN04 # poll a single table
"""

import argparse
import logging
import sys
import time
from datetime import datetime

from .config import POLL_INTERVAL_SECONDS, CDC_TABLES, KAFKA_BOOTSTRAP
from .poller import CDCPoller

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cdc.runner")


def _create_kafka_producer():
    """Try to create a Kafka producer. Returns None if Kafka is unavailable."""
    try:
        from kafka import KafkaProducer
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_serializer=None,  # We send raw bytes
            acks="all",
            retries=3,
            max_block_ms=5000,
        )
        logger.info(f"Kafka producer connected to {KAFKA_BOOTSTRAP}")
        return producer
    except ImportError:
        logger.warning("kafka-python not installed. Kafka publishing disabled. Install with: pip install kafka-python")
        return None
    except Exception as e:
        logger.warning(f"Kafka unavailable ({e}). Publishing disabled — events will only go to Supabase.")
        return None


def run_once(poller: CDCPoller, table: str | None = None):
    """Run a single poll cycle."""
    start = time.time()
    logger.info(f"{'='*60}")
    logger.info(f"CDC poll cycle started at {datetime.utcnow().isoformat()}")

    if table:
        if table not in CDC_TABLES:
            logger.error(f"Table {table} not in CDC_TABLES config. Available: {list(CDC_TABLES.keys())}")
            return []
        results = [poller.poll_table(table, CDC_TABLES[table])]
    else:
        results = poller.poll_all()

    elapsed = time.time() - start
    total_changes = sum(r.get("changes", 0) for r in results)
    errors = [r for r in results if r.get("error")]

    logger.info(f"CDC cycle complete: {total_changes} changes across {len(results)} tables in {elapsed:.1f}s")
    if errors:
        logger.warning(f"  {len(errors)} tables had errors: {[e['table'] for e in errors]}")
    logger.info(f"{'='*60}")
    return results


def run_daemon(poller: CDCPoller, interval: int):
    """Run continuously, polling every `interval` seconds."""
    logger.info(f"CDC daemon starting. Poll interval: {interval}s ({interval//60}min)")
    logger.info(f"Tracking {len(CDC_TABLES)} tables: {list(CDC_TABLES.keys())}")

    cycle = 0
    while True:
        cycle += 1
        logger.info(f"\n--- Cycle #{cycle} ---")
        try:
            run_once(poller)
        except KeyboardInterrupt:
            logger.info("CDC daemon stopped by user.")
            break
        except Exception as e:
            logger.error(f"Unhandled error in cycle #{cycle}: {e}", exc_info=True)

        logger.info(f"Sleeping {interval}s until next poll...")
        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("CDC daemon stopped by user.")
            break


def main():
    parser = argparse.ArgumentParser(description="CDC Poller for PcGraf → Supabase + Kafka")
    parser.add_argument("--daemon", action="store_true", help="Run continuously")
    parser.add_argument("--table", type=str, help="Poll a single table (e.g. IN04)")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS, help="Poll interval in seconds")
    parser.add_argument("--no-kafka", action="store_true", help="Disable Kafka publishing")
    args = parser.parse_args()

    # Create Kafka producer
    kafka_producer = None if args.no_kafka else _create_kafka_producer()

    # Create poller
    poller = CDCPoller(kafka_producer=kafka_producer)

    if args.daemon:
        run_daemon(poller, args.interval)
    else:
        results = run_once(poller, table=args.table)
        for r in results:
            status = "OK" if not r.get("error") else f"ERROR: {r['error']}"
            print(f"  {r['table']:15s}  changes={r.get('changes',0):>5}  sb={r.get('committed_supabase',0):>5}  kf={r.get('published_kafka',0):>5}  {status}")

    # Cleanup
    if kafka_producer:
        kafka_producer.close()


if __name__ == "__main__":
    main()
