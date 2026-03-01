# Prompt: Build a Standalone Data Model & Monitoring Dashboard

> **Use this prompt in a fresh Windsurf Cascade project to recreate the full Data Model Dashboard as a standalone app.**

---

## 1. PROJECT OVERVIEW

Build a new tab/module (next to Ontology, Copilot, Spaces, etc) called **"Data Model Dashboard"** — a comprehensive data modeling, monitoring, and curation tool for an enterprise treasury system. The app has:

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + `@xyflow/react` for ER diagrams + `lucide-react` for icons
- **Backend**: Python (Starlette) API server with endpoints for schema introspection, Kafka status, ERP schema, CDC monitoring, FAISS KB stats, and data curation write-back
- **Data Sources**: Supabase (PostgreSQL), PcGraf ERP (SQL Server via pymssql), Kafka (Strimzi on AKS), FAISS vector knowledge base

The UI is a single-page dashboard with **6 tabs**:
1. **Modelo ER** — Interactive ER diagram of all database tables with PKs/FKs, color-coded by schema
2. **CDC Monitor** — Real-time Change Data Capture watermarks, event counts, per-table poll trigger
3. **Kafka Monitor** — Kafka cluster overview, 24 topics, partitions, replication factor
4. **ERP PcGraf** — Full PcGraf ERP schema with columns, types, PKs, row counts, tech→business name mapping
5. **FAISS KB** — Knowledge base stats, sync triggers, architecture diagram
6. **Curación de Datos** — Per-table row editor with multi-target write-back (Supabase + FAISS + ERP)

---

## 2. TECH STACK — EXACT VERSIONS

### Frontend (package.json)
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.57.4",
    "@xyflow/react": "^12.10.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.344.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.13.0",
    "recharts": "^3.7.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.18",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.2"
  }
}
```

### Backend (Python)
- `starlette` for HTTP server
- `httpx` for Supabase REST API calls
- `pymssql>=2.2.0` for PcGraf SQL Server
- `python-dotenv` for env loading

### Environment Variables
```env
# Frontend (.env)
VITE_AGENT_URL=http://localhost:8000   # Backend API base URL
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Backend (.env)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PCGRAF_SQL_SERVER=192.168.1.3
PCGRAF_SQL_USER=vflores
PCGRAF_SQL_PASSWORD=9547Fl0r3$
PCGRAF_SQL_DATABASE=siawin0
KAFKA_BOOTSTRAP_SERVERS=treasury-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092
KAFKA_TOPIC_PREFIX=siawin0
```

---

## 3. BRAND / DESIGN SYSTEM

- **Primary color**: `#1A4A28` (dark green — ARA Group corporate)
- **Focus rings**: `focus:ring-[#1A4A28]`
- **Font**: System default (Tailwind)
- **UI language**: Spanish (labels, messages, tooltips)
- **Card style**: `bg-white rounded-lg border border-gray-200 shadow-sm`
- **Badge variants**: `default` (gray), `success` (green), `warning` (yellow), `error` (red), `info` (blue)
- **Button variants**: `primary` (#1A4A28), `outline`, `secondary`, `ghost`, `danger`

---

## 4. SUPABASE DATABASE SCHEMAS

The Supabase instance has 4 schemas with tables:

| Schema | Purpose | Example Tables |
|--------|---------|---------------|
| `silver_finance` | Cleaned financial data | `cxp_items`, `flujo_semanal`, `projection_12m`, `mrp_master`, `cxc_items`, `ingest_runs` |
| `bronze_finance` | Raw ingested data | Raw Excel/CSV imports |
| `tms` | Treasury Management (CDC mirror) | 23 tables mirrored from PcGraf ERP (see CDC_TABLES below) |
| `dim` | Dimension tables | Lookup/reference tables |

The ER diagram must query `information_schema.tables`, `information_schema.columns`, `information_schema.table_constraints`, and `information_schema.key_column_usage` across all 4 schemas to get columns, PKs, and FKs.

The Supabase REST API is used via the `exec_sql` RPC function:
```
POST {SUPABASE_URL}/rest/v1/rpc/exec_sql
Headers: Authorization: Bearer {SERVICE_ROLE_KEY}, apikey: {SERVICE_ROLE_KEY}
Body: { "sql_query": "SELECT ..." }
```

---

## 5. PCGRAF ERP — LEGACY SQL SERVER

PcGraf is a legacy ERP system running on SQL Server at `192.168.1.3`, database `siawin0`. Connection via `pymssql`.

### CDC_TABLES — 23 Tables Tracked via Change Data Capture

Each table has a CDC detection strategy (`checksum`, `timestamp`, or `pk_max`), primary key column(s), optional date column, and a business entity name:

```python
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
```

### ERP Module Grouping (by table prefix)
| Prefix | Module | Color |
|--------|--------|-------|
| IN | Inventario | blue |
| FA | Facturación | green |
| CP | Compras / CxP | orange |
| CC | Cuentas por Cobrar | purple |
| CO | Contabilidad | indigo |
| BA | Bancos | teal |
| TC | Tipos de Cambio | amber |
| GE | General | gray |

### Tech → Business Column Name Mapping
```typescript
const COLUMN_BUSINESS_NAMES: Record<string, string> = {
  sCodigo: 'Código Producto', sDescripcion: 'Descripción', sCodigo_Barras: 'Código de Barras',
  nPrecio: 'Precio', nCosto: 'Costo', nExistencia: 'Existencia', sBodega: 'Bodega',
  sProveedor: 'Proveedor', sCliente: 'Cliente', sPedido: 'Pedido', sOrden: 'Orden de Compra',
  sFactura: 'Factura', sRecibo: 'Recibo', sDocumento: 'Documento', dFecha: 'Fecha',
  dFecha_Ingreso: 'Fecha Ingreso', dFecha_Documento: 'Fecha Documento', nMonto: 'Monto',
  nSaldo: 'Saldo', nTotal: 'Total', sCuenta: 'Cuenta Contable', sConsecutivo: 'Consecutivo',
  sLlave: 'Llave', iLinea: 'Línea', sRecepcion: 'Recepción', cAnio: 'Año', bMes: 'Mes',
  sTipo_Documento: 'Tipo Documento', sNumero_Documento: 'Número Documento',
};
```

---

## 6. KAFKA CLUSTER (AKS)

- **Kafka 4.0.0** in KRaft mode (NO ZooKeeper)
- **Strimzi 0.50.1** operator
- **3 brokers + 3 controllers** on AKS (3 nodes Standard_D2s_v3)
- **24 topics**: 23 CDC topics (`siawin0.IN04`, `siawin0.IN13`, ...) + 1 DLQ (`siawin0.dlq`)
- **All topics**: RF=3, partitions=3, min.isr=2
- **Bootstrap**: `treasury-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092`

---

## 7. FAISS KNOWLEDGE BASE

- Unified FAISS vector store indexing ALL data: 7 silver_finance tables + 16 tms ERP tables + Excel/DOCX files + CDC events
- Auto-sync daemon every 4 minutes
- CDC-triggered incremental refresh
- **Endpoints**:
  - `GET /kb/stats` → `{ total_documents, total_tables, last_sync, sync_interval_seconds, tables_indexed }`
  - `POST /kb/sync` → triggers full rebuild
  - `POST /kb/cdc_refresh` → triggers incremental refresh
- **Architecture flow**: PcGraf ERP → CDC Poller (5min) → [Supabase + Kafka + FAISS KB] → AI Chat / BI Charts (triple-commit)

---

## 8. BACKEND API ENDPOINTS TO BUILD

All endpoints are async Starlette handlers returning `JSONResponse`.

### 8.1 `GET /data-model/schema` — Supabase Schema for ER Diagram
- Queries `information_schema.tables` + `information_schema.columns` for schemas: `silver_finance`, `bronze_finance`, `tms`, `dim`
- Also queries FK relationships via `information_schema.table_constraints` + `key_column_usage` + `constraint_column_usage`
- Uses Supabase `exec_sql` RPC
- Returns: `{ tables: SchemaTable[], foreign_keys: ForeignKey[] }`

### 8.2 `GET /data-model/kafka` — Kafka Cluster & Topic Status
- Reads CDC_TABLES config to enumerate topics
- Returns static cluster config + topic list
- Returns: `{ bootstrap, topic_prefix, topics: KafkaTopic[], cluster: KafkaCluster }`

### 8.3 `GET /data-model/erp-schema` — PcGraf ERP Table Schema
- Connects to PcGraf SQL Server via `pymssql`
- For each CDC table: queries `INFORMATION_SCHEMA.COLUMNS`, gets row count, maps PK columns
- Returns: `{ database, tables: ERPTable[] }`

### 8.4 `POST /data-model/curation` — Multi-Target Data Write-Back
- Body: `{ table, schema, row_id, changes: {col: val}, targets: ['supabase','erp','faiss'], pk_col? }`
- Supabase: PATCH via REST API with schema profile headers
- ERP: UPDATE via pymssql with parameterized query
- FAISS: triggers incremental_sync()
- Returns: `{ results: { supabase: {status, code}, erp: {status, rows_affected}, faiss: {status} } }`

### 8.5 Existing endpoints to also implement:
- `GET /cdc/status` → `{ watermarks: CDCWatermark[], recent_event_counts, total_recent_events }`
- `POST /cdc/poll` → `{ results }` (body: `{ table? }`)
- `GET /cdc/registry` → `{ tables: TableRegistryEntry[] }`
- `GET /kb/stats` → `{ total_documents, total_tables, last_sync, sync_interval_seconds, tables_indexed }`
- `POST /kb/sync` → `{ status }`
- `POST /kb/cdc_refresh` → `{ status }`

---

## 9. FRONTEND — DETAILED COMPONENT SPECS

### 9.1 UI Primitives (create these first)

**`src/lib/utils.ts`** — `cn()` utility using `clsx`:
```typescript
import { clsx, type ClassValue } from 'clsx';
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }
```

**`src/components/ui/Card.tsx`** — Card, CardHeader, CardTitle, CardContent (all forwardRef):
- Card: `bg-white rounded-lg border border-gray-200 shadow-sm`
- CardHeader: `px-6 py-4 border-b border-gray-200`
- CardTitle: `text-lg font-semibold text-gray-900`
- CardContent: `px-6 py-4`

**`src/components/ui/Button.tsx`** — variants: primary (#1A4A28), secondary, outline, ghost, danger; sizes: sm, md, lg

**`src/components/ui/Badge.tsx`** — variants: default (gray), success (green), warning (yellow), error (red), info (blue); rounded-full pill style

**`src/components/ui/LoadingSpinner.tsx`** — animated spinning border, sizes sm/md/lg, color #1A4A28

### 9.2 API Client: `src/lib/dataModel.ts`

Typed fetch wrapper with all TypeScript interfaces and API functions:

**Types to define:**
- `SchemaColumn` { column_name, data_type, is_nullable, column_default, ordinal_position }
- `SchemaTable` { table_schema, table_name, columns: SchemaColumn[] | null, primary_keys: string[] | null }
- `ForeignKey` { table_schema, table_name, column_name, foreign_table_schema, foreign_table_name, foreign_column_name }
- `DataModelSchema` { tables, foreign_keys, error? }
- `KafkaTopic` { name, table, entity, partitions, replication_factor }
- `KafkaCluster` { brokers, controllers, version, mode, strimzi_version }
- `KafkaStatus` { bootstrap, topic_prefix, topics, cluster, error? }
- `ERPColumn` { name, type, max_length, nullable, is_pk, ordinal }
- `ERPTable` { sql_table, entity, strategy, date_col, pk_columns, row_count, columns, error? }
- `ERPSchema` { database, tables, error? }
- `CDCWatermark` { id?, sql_table_name, last_checksum?, last_pk_value?, last_timestamp?, rows_at_last_poll?, last_poll_at?, changes_detected? }
- `CDCStatus` { watermarks, recent_event_counts, total_recent_events, error? }
- `TableRegistryEntry` { id?, sql_table_name, entity_name, erp_module, business_name?, description?, supabase_table?, sync_enabled? }
- `KBStats` { total_documents, total_tables, last_sync, sync_interval_seconds, tables_indexed, error? }
- `CurationResult` { results: Record<string, { status, message?, code?, rows_affected? }> }

**API functions:**
- `getDataModelSchema()` → GET /data-model/schema
- `getKafkaStatus()` → GET /data-model/kafka
- `getERPSchema()` → GET /data-model/erp-schema
- `getCDCStatus()` → GET /cdc/status
- `getTableRegistry()` → GET /cdc/registry
- `getKBStats()` → GET /kb/stats
- `triggerCDCPoll(table?)` → POST /cdc/poll
- `saveCuration({table, schema, row_id, changes, targets, pk_col?})` → POST /data-model/curation
- `triggerKBSync()` → POST /kb/sync
- `triggerKBCDCRefresh()` → POST /kb/cdc_refresh

### 9.3 Main Page: `DataModelDashboard.tsx`

- 6-tab layout with icons from lucide-react
- Tab bar: horizontal scrollable, border-bottom active indicator with brand color
- Each tab lazy-renders its component
- Tabs:
  | Tab ID | Label | Icon | Color |
  |--------|-------|------|-------|
  | er-diagram | Modelo ER | GitBranch | indigo-600 |
  | cdc-monitor | CDC Monitor | Activity | emerald-600 |
  | kafka-monitor | Kafka Monitor | Radio | orange-600 |
  | erp-model | ERP PcGraf | Server | blue-600 |
  | faiss-kb | FAISS KB | Brain | purple-600 |
  | curation | Curación de Datos | PenTool | rose-600 |

### 9.4 Tab 1: ERDiagramTab — Interactive ER Diagram

**Library**: `@xyflow/react` (ReactFlow v12+)
- Import: `ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, MarkerType`
- Import CSS: `@xyflow/react/dist/style.css`

**Schema color coding:**
| Schema | Background | Border | Header |
|--------|-----------|--------|--------|
| silver_finance | #f0fdf4 | #16a34a | #15803d |
| bronze_finance | #fefce8 | #ca8a04 | #a16207 |
| tms | #eff6ff | #2563eb | #1d4ed8 |
| dim | #faf5ff | #9333ea | #7e22ce |

**Custom `TableNode` component:**
- Colored header with table name + schema badge
- List of columns (max 12 shown, "+N more" overflow)
- PK columns highlighted with amber "PK" badge
- Column type shown in gray on the right
- Optional row count footer

**Layout algorithm:**
- Group tables by schema, arrange in grid (max 4 columns per schema group)
- 320px horizontal spacing, 340px vertical spacing
- 80px gap between schema groups

**FK edges:**
- Animated dashed lines with ArrowClosed marker
- Label: `column_name → foreign_column_name`
- Color: #94a3b8

**Toolbar:**
- Search input (filter by table name)
- Schema dropdown filter
- Stats: "N tablas", "N relaciones"
- Refresh button

**Legend:** Color dots for each schema

**Canvas:** 700px height, fitView, minZoom 0.1, maxZoom 2, MiniMap with schema-colored nodes

### 9.5 Tab 2: CDCMonitorTab

**Summary cards (4-column grid):**
1. Tablas Monitoreadas (count) — Activity icon, emerald
2. Eventos Recientes (total) — Zap icon, amber
3. Tablas Sincronizadas (count with last_poll_at) — CheckCircle, green
4. Intervalo de Polling: "5 min" — Clock, blue

**Sort controls:** pill buttons for Tabla / Cambios / Último Poll

**"Poll All Now" button** — triggers POST /cdc/poll

**Table grid (3-column responsive):**
- Each card shows: sql_table_name, business name, last poll time (timeAgo), rows at last poll, changes detected
- Visual indicators: amber border if changes > 0, red border if stale (>10min), green checkmark if ok
- Per-card "Poll ahora" button

**Auto-refresh:** every 30 seconds

### 9.6 Tab 3: KafkaMonitorTab

**Cluster overview (4 gradient cards):**
1. Brokers count — Server icon, orange gradient
2. Controllers count — HardDrive icon, blue gradient
3. Topics count — Radio icon, green gradient
4. Mode + Version — Wifi icon, purple gradient

**Cluster Configuration card:** Bootstrap, Topic Prefix, Strimzi version, Replication info

**Topics table:**
- Columns: Topic (monospace), Tabla ERP (badge), Entidad, Particiones (blue circle), RF (green circle), Estado (green pulse dot + "Active")
- Filter input
- Refresh button

### 9.7 Tab 4: ERPModelTab — PcGraf Semantic Model

**Header info:** Database name, table count, total row count

**Controls:** "Mostrar mapping Tech → Business" checkbox toggle, Expand All / Collapse All buttons, search input

**Grouped by ERP module** (IN=Inventario, FA=Facturación, etc.) — each module is a colored Card

**Each table row (collapsible):**
- ChevronDown/Right toggle
- Table name (monospace bold) → business name (arrow)
- Entity name, row count badge, strategy badge (color-coded: timestamp=success, pk_max=warning, checksum=default)
- PK columns with Key icon

**Expanded view (table):**
- Columns: #, Columna (Tech), Nombre Business (with arrow mapping), Tipo (with max_length), PK (key icon), Nullable
- PK rows highlighted with amber background
- Business name column toggleable

### 9.8 Tab 5: FAISSMonitorTab

**Summary cards (4 gradient cards):**
1. Documentos Indexados — FileText, purple
2. Tablas Indexadas — Database, blue
3. Última Sincronización (timeAgo) — Clock, green
4. Intervalo Auto-Sync (minutes) — RefreshCw, amber

**Actions card:**
- "Full Sync (Rebuild)" button (primary)
- "CDC Incremental Refresh" button (outline)
- "Refresh Stats" button (outline)
- Description text about auto-sync daemon and triple-commit

**Indexed tables card:** Badge list of all indexed table names

**Architecture diagram card:** Visual flow:
`PcGraf ERP → CDC Poller (5min) → [Supabase / Kafka / FAISS KB] → AI Chat / BI Charts`
With colored boxes and description of triple-commit

**Auto-refresh:** every 60 seconds

### 9.9 Tab 6: DataCurationTab — Per-Table Data Editor

**Layout:** 3-column grid (1 left sidebar + 2 right content)

**Left sidebar:**
1. **Table list card:** Searchable list of all CDC tables from registry. Selected table highlighted with brand color (#1A4A28 bg, white text). Shows entity name and row count.
2. **Target selection card:** 3 checkboxes:
   - ☑ Supabase (Modelo) — Database icon, green
   - ☑ FAISS Knowledge Base — Brain icon, purple
   - ☐ PcGraf SQL ERP DB — Server icon, blue (with amber warning when checked: "Escribir en PcGraf ERP modifica datos de producción. Use con precaución.")

**Right content:**
- Empty state: PenTool icon + "Seleccione una tabla para ver y editar datos"
- Loading state: spinner
- Data table:
  - Loads rows from Supabase (tries `tms` schema first, then `silver_finance`)
  - Shows first 10 columns, "+N cols" overflow indicator
  - Sticky header
  - "Editar" button per row → inline text inputs for all editable columns (skip id, created_at, updated_at)
  - "Guardar" button → calls saveCuration with selected targets
  - Diff detection: only sends changed fields
  - Success/error toast messages

**Supabase client:** Uses `@supabase/supabase-js` with `.schema('tms' as 'public')` for cross-schema queries

---

## 10. ROUTING & NAVIGATION

- Route: `/data-model` → `DataModelDashboard`
- Navbar item: `{ name: 'Modelo de Datos', href: '/data-model', icon: GitBranch }`
- Place between "Fuentes de Datos" and "Proyectos" in nav order

---

## 11. BUILD & DEPLOY

### Local Development
```bash
# Frontend
npm install
npm run dev  # Vite dev server on :5173

# Backend
cd agent
pip install starlette uvicorn httpx pymssql python-dotenv
uvicorn server:app --reload --port 8000
```

### Docker (Multi-stage)
```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Python backend + static files
FROM python:3.11-slim
RUN apt-get update && apt-get install -y freetds-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent/ ./agent/
COPY --from=frontend /app/dist ./static/
ENV STATIC_DIR=/app/static
CMD ["uvicorn", "agent.server:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Azure Container Apps
```bash
# Build image in ACR
az acr build --registry <ACR_NAME> --image treasury-copilot-agent:latest --file agent/Dockerfile .

# Update container app (triggers new revision)
az containerapp update --name <APP_NAME> --resource-group <RG> --set-env-vars "DEPLOY_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

---

## 12. KEY IMPLEMENTATION NOTES

1. **ReactFlow `@xyflow/react` v12+** — Use `useNodesState`/`useEdgesState` hooks, NOT the old `react-flow-renderer` package. Import CSS from `@xyflow/react/dist/style.css`.

2. **Supabase cross-schema queries** — Use `.schema('tms' as 'public')` cast to bypass TypeScript schema typing. The `exec_sql` RPC function is used for raw SQL in the backend.

3. **PcGraf SQL Server** — Uses `pymssql` with parameterized queries (`%s` placeholders). Table names use bracket escaping `[TableName]`. Credentials are server-side only.

4. **CDC watermarks** are stored in Supabase `tms.cdc_watermarks` table. The poller runs as a CronJob on AKS every 5 minutes.

5. **Triple-commit pattern** — Every CDC change is written to Supabase + published to Kafka + triggers FAISS KB refresh. The curation tab's write-back follows the same pattern.

6. **Error handling** — All API calls wrapped in try/catch. Backend returns `{ error: string }` on failure. Frontend shows error cards with retry buttons.

7. **Auto-refresh** — CDC Monitor refreshes every 30s, FAISS Monitor every 60s. Use `setInterval` in `useEffect` with cleanup.

8. **The app should be fully functional as a standalone project** — create all necessary files, configs, and dependencies from scratch. Do not assume any pre-existing code.
