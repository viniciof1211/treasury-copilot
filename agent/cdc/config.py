"""CDC configuration — connection details, polling intervals, table mappings."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from agent directory
load_dotenv(Path(__file__).parent.parent / ".env")

# ── PcGraf SQL Server ──────────────────────────────────────────────────────
PCGRAF_HOST = os.environ.get("PCGRAF_SQL_SERVER", "192.168.1.3")
PCGRAF_USER = os.environ.get("PCGRAF_SQL_USER", "vflores")
PCGRAF_PASS = os.environ.get("PCGRAF_SQL_PASSWORD", "9547Fl0r3$")
PCGRAF_DB   = os.environ.get("PCGRAF_SQL_DATABASE", "siawin0")

# ── Supabase ───────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# ── Kafka ──────────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC_PREFIX = os.environ.get("KAFKA_TOPIC_PREFIX", "siawin0")

# ── CDC Settings ───────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = int(os.environ.get("CDC_POLL_INTERVAL", "300"))  # 5 min
BATCH_SIZE = int(os.environ.get("CDC_BATCH_SIZE", "1000"))
MAX_ROWS_PER_TABLE = int(os.environ.get("CDC_MAX_ROWS", "50000"))

# ── Tables to track (sql_table → detection strategy) ──────────────────────
# Strategy: 'checksum' = hash all rows, 'timestamp' = use date column, 'pk_max' = track max PK
CDC_TABLES = {
    "IN04":  {"strategy": "checksum",  "pk": "sCodigo",                     "date_col": None,              "entity": "productos"},
    "IN13":  {"strategy": "checksum",  "pk": "sCodigo",                     "date_col": None,              "entity": "proveedores"},
    "IN14":  {"strategy": "checksum",  "pk": "sLlave",                      "date_col": None,              "entity": "inventario_bodega"},
    "IN11":  {"strategy": "pk_max",    "pk": "sConsecutivo",                "date_col": "dFecha",          "entity": "movimientos_inventario"},
    "IN16":  {"strategy": "pk_max",    "pk": "sLlave",                      "date_col": None,              "entity": "kardex"},
    "IN34":  {"strategy": "pk_max",    "pk": "sLlave",                      "date_col": None,              "entity": "transacciones_inv"},
    "IN42":  {"strategy": "checksum",  "pk": "sOrden,iLinea",               "date_col": None,              "entity": "ordenes_compra_inv"},
    "IN64":  {"strategy": "checksum",  "pk": "sCodigo",                     "date_col": None,              "entity": "bodegas"},
    "IN97":  {"strategy": "pk_max",    "pk": "sLlave",                      "date_col": None,              "entity": "historico_costos"},
    "FA01":  {"strategy": "pk_max",    "pk": "sPedido,iLinea",              "date_col": None,              "entity": "lineas_factura"},
    "FA12":  {"strategy": "timestamp", "pk": "sPedido",                     "date_col": "dFecha",          "entity": "facturas"},
    "FA20":  {"strategy": "checksum",  "pk": "sCodigo",                     "date_col": None,              "entity": "clientes"},
    "FA25":  {"strategy": "pk_max",    "pk": "sRecibo",                     "date_col": "dFecha",          "entity": "recibos_caja"},
    "CP10":  {"strategy": "timestamp", "pk": "sOrden",                      "date_col": "dFecha_Ingreso",  "entity": "ordenes_compra"},
    "CP11":  {"strategy": "checksum",  "pk": "sOrden,iLinea",               "date_col": None,              "entity": "lineas_oc"},
    "CP12":  {"strategy": "pk_max",    "pk": "sRecepcion,iLinea",           "date_col": None,              "entity": "recepciones_compra"},
    "CP21":  {"strategy": "timestamp", "pk": "sDocumento",                  "date_col": "dFecha_Documento","entity": "cuentas_por_pagar"},
    "CP31":  {"strategy": "pk_max",    "pk": "sDocumento",                  "date_col": None,              "entity": "pagos_proveedores"},
    "CC10":  {"strategy": "timestamp", "pk": "cAnio,bMes,sTipo_Documento,sNumero_Documento,sCliente", "date_col": "dFecha", "entity": "cuentas_por_cobrar"},
    "CO00":  {"strategy": "checksum",  "pk": "sCuenta",                     "date_col": None,              "entity": "plan_cuentas"},
    "BA10":  {"strategy": "timestamp", "pk": "sDocumento",                  "date_col": "dFecha_Documento","entity": "movimientos_bancarios"},
    "TC":    {"strategy": "timestamp", "pk": "dFecha",                      "date_col": "dFecha",          "entity": "tipos_cambio"},
    "GE01":  {"strategy": "checksum",  "pk": "",                            "date_col": "dFecha",          "entity": "catalogos_generales"},
}
