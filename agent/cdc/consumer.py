"""
Kafka Consumer for TMS — subscribes to siawin0.* topics and processes CDC events.
This consumer runs as a separate process and updates the TMS app state.

Usage:
    python -m cdc.consumer                    # consume all topics
    python -m cdc.consumer --topics IN04 CP10 # consume specific tables
"""

import argparse
import json
import logging
import signal
import sys
import time
from datetime import datetime

from .config import KAFKA_BOOTSTRAP, KAFKA_TOPIC_PREFIX, SUPABASE_URL, SUPABASE_KEY, CDC_TABLES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cdc.consumer")

# Graceful shutdown
_running = True

def _signal_handler(sig, frame):
    global _running
    logger.info("Shutdown signal received. Stopping consumer...")
    _running = False

signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


class CDCConsumer:
    """Consumes CDC events from Kafka topics and applies them to Supabase canonical tables."""

    def __init__(self, topics: list[str]):
        self.topics = topics
        self._supabase_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        self.stats = {t: {"received": 0, "applied": 0, "errors": 0} for t in topics}

    def _apply_event(self, topic: str, event: dict) -> bool:
        """Apply a single CDC event to the corresponding Supabase canonical table."""
        table = event.get("table", topic.replace(f"{KAFKA_TOPIC_PREFIX}.", ""))
        event_type = event.get("type", "INSERT")
        data = event.get("data", {})
        pk = event.get("pk", "")

        if not data:
            return False

        # Find the canonical entity name from CDC_TABLES config
        cfg = CDC_TABLES.get(table, {})
        entity = cfg.get("entity", table.lower())
        supabase_table = f"tms.{entity}" if entity else None

        if not supabase_table or not SUPABASE_URL:
            logger.debug(f"No Supabase mapping for {table}, skipping")
            return False

        try:
            import httpx

            # Build the upsert payload with _pcgraf_pk for deduplication
            row = {
                "_pcgraf_pk": pk,
                "_synced_at": datetime.utcnow().isoformat(),
            }

            # Map common fields based on entity type
            row.update(self._map_fields(entity, data))

            # Upsert to Supabase (uses _pcgraf_pk as conflict key)
            resp = httpx.post(
                f"{SUPABASE_URL}/rest/v1/{entity}",
                json=row,
                headers=self._supabase_headers,
                timeout=15.0,
            )

            if resp.status_code in (200, 201, 204):
                return True
            else:
                logger.warning(f"Supabase upsert failed for {entity}/{pk}: {resp.status_code} {resp.text[:100]}")
                return False

        except Exception as e:
            logger.error(f"Apply event error for {table}/{pk}: {e}")
            return False

    def _map_fields(self, entity: str, data: dict) -> dict:
        """Map raw PcGraf column names to canonical TMS field names."""
        # Generic mapping — strips whitespace from all string values
        mapped = {}
        for k, v in data.items():
            clean_key = k.strip().lower()
            clean_val = v.strip() if isinstance(v, str) else v
            mapped[clean_key] = clean_val

        # Entity-specific mappings
        if entity == "productos":
            return {
                "codigo": mapped.get("scodigo", ""),
                "descripcion": mapped.get("sdescripcion", ""),
                "grupo": mapped.get("sgrupo", ""),
                "unidad_medida": mapped.get("sunid_medida", ""),
                "marca": mapped.get("smarca", ""),
                "costo_promedio": mapped.get("ccostopromedio", 0),
                "costo_ultimo": mapped.get("ccostoultimo", 0),
                "estado": mapped.get("bestado", 1),
                "proveedor_principal": mapped.get("sproveedor", ""),
            }
        elif entity == "proveedores":
            return {
                "codigo": mapped.get("scodigo", ""),
                "nombre": mapped.get("snombre", ""),
                "cedula_juridica": mapped.get("scedula", ""),
                "telefono": mapped.get("stelefono", ""),
                "email": mapped.get("semail", ""),
                "contacto": mapped.get("scontacto", ""),
                "estado": mapped.get("bestado", 1),
            }
        elif entity == "clientes":
            return {
                "codigo": mapped.get("scodigo", mapped.get("scodigocliente", "")),
                "nombre": mapped.get("snombre", ""),
                "cedula": mapped.get("scedula", ""),
                "vendedor": mapped.get("svendedor", ""),
                "estado": mapped.get("bestado", 1),
            }
        elif entity == "ordenes_compra":
            return {
                "orden": mapped.get("sorden", ""),
                "codigo_proveedor": mapped.get("sproveedor", ""),
                "fecha_orden": mapped.get("dfecha", mapped.get("dfecha_ingreso", None)),
                "moneda": "CRC" if mapped.get("bmoneda") == 1 else "USD",
                "total": mapped.get("ctotal", 0),
                "estado": "Pendiente" if mapped.get("bestado", 0) == 0 else "Completa",
            }
        elif entity == "lineas_oc":
            return {
                "orden": mapped.get("sorden", ""),
                "linea": mapped.get("ilinea", 0),
                "codigo_producto": mapped.get("scodigo_producto", mapped.get("sproducto", "")),
                "descripcion": mapped.get("sdescripcion", ""),
                "cantidad": mapped.get("ccantidad", 0),
                "costo_unitario": mapped.get("ccosto", mapped.get("cprecio", 0)),
            }
        elif entity == "facturas":
            return {
                "pedido": mapped.get("spedido", ""),
                "codigo_cliente": mapped.get("scliente", mapped.get("scodigocliente", "")),
                "fecha": mapped.get("dfecha", None),
                "total": mapped.get("ctotal", 0),
                "estado": "Pendiente" if mapped.get("bestado", 0) == 0 else "Pagada",
            }
        elif entity == "cuentas_por_pagar":
            return {
                "documento": mapped.get("sdocumento", ""),
                "codigo_proveedor": mapped.get("sproveedor", ""),
                "tipo_documento": mapped.get("stipo_documento", ""),
                "fecha_documento": mapped.get("dfecha_documento", None),
                "monto_original": mapped.get("cmonto_documento", 0),
                "monto_pendiente": mapped.get("cmonto_pendiente", 0),
            }
        elif entity == "movimientos_bancarios":
            return {
                "documento": mapped.get("sdocumento", ""),
                "cuenta_bancaria": mapped.get("scuenta", ""),
                "tipo_documento": mapped.get("stipo_documento", ""),
                "fecha": mapped.get("dfecha_documento", None),
                "monto": mapped.get("cmonto_documento", 0),
                "beneficiario": mapped.get("sbeneficiario", ""),
            }
        elif entity == "tipos_cambio":
            return {
                "fecha": mapped.get("dfecha", None),
                "compra": mapped.get("ccompra", 0),
                "venta": mapped.get("cventa", 0),
            }

        # Fallback: return raw mapped data
        return mapped

    def consume(self, max_messages: int = 0):
        """Start consuming from Kafka topics."""
        try:
            from kafka import KafkaConsumer
        except ImportError:
            logger.error("kafka-python not installed. Install with: pip install kafka-python")
            return

        full_topics = [f"{KAFKA_TOPIC_PREFIX}.{t}" if "." not in t else t for t in self.topics]
        logger.info(f"Subscribing to Kafka topics: {full_topics}")

        try:
            consumer = KafkaConsumer(
                *full_topics,
                bootstrap_servers=KAFKA_BOOTSTRAP,
                group_id="tms-consumer",
                auto_offset_reset="earliest",
                enable_auto_commit=True,
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
                consumer_timeout_ms=5000,  # 5s timeout for poll
            )
        except Exception as e:
            logger.error(f"Cannot connect to Kafka at {KAFKA_BOOTSTRAP}: {e}")
            return

        logger.info("Kafka consumer started. Waiting for messages...")
        msg_count = 0

        while _running:
            try:
                messages = consumer.poll(timeout_ms=3000)
                for tp, records in messages.items():
                    for record in records:
                        topic = record.topic
                        event = record.value
                        table = topic.replace(f"{KAFKA_TOPIC_PREFIX}.", "")

                        if table not in self.stats:
                            self.stats[table] = {"received": 0, "applied": 0, "errors": 0}
                        self.stats[table]["received"] += 1

                        success = self._apply_event(topic, event)
                        if success:
                            self.stats[table]["applied"] += 1
                        else:
                            self.stats[table]["errors"] += 1

                        msg_count += 1
                        if msg_count % 100 == 0:
                            logger.info(f"Processed {msg_count} messages. Stats: {self.stats}")

                        if max_messages and msg_count >= max_messages:
                            logger.info(f"Reached max_messages={max_messages}. Stopping.")
                            _running and consumer.close()
                            return

            except Exception as e:
                logger.error(f"Consumer error: {e}", exc_info=True)
                time.sleep(1)

        consumer.close()
        logger.info(f"Consumer stopped. Total processed: {msg_count}. Stats: {self.stats}")


def main():
    parser = argparse.ArgumentParser(description="TMS Kafka Consumer for CDC events")
    parser.add_argument("--topics", nargs="+", help="Specific tables to consume (e.g. IN04 CP10)")
    parser.add_argument("--max", type=int, default=0, help="Max messages to process (0=unlimited)")
    args = parser.parse_args()

    topics = args.topics or list(CDC_TABLES.keys())
    consumer = CDCConsumer(topics=topics)
    consumer.consume(max_messages=args.max)


if __name__ == "__main__":
    main()
