# ARA Treasury Management System — Full Architecture

> **Version**: 2.0 · **Date**: 2026-03-01 · **Status**: Architectural Blueprint
> **Vision**: A Transactional Read/Write AI-Powered TMS — SunGard Quantum-class features
> built on modern cloud-native infrastructure, replacing Excel-driven treasury operations.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Data Virtualization Layer](#3-data-virtualization-layer)
4. [Module Architecture](#4-module-architecture)
5. [Canonical Data Model](#5-canonical-data-model)
6. [Business Rules Engine](#6-business-rules-engine)
7. [AI & Analytics Layer](#7-ai--analytics-layer)
8. [Transaction Processing](#8-transaction-processing)
9. [Integration Architecture](#9-integration-architecture)
10. [Security & Audit](#10-security--audit)
11. [Deployment & Infrastructure](#11-deployment--infrastructure)
12. [Migration Roadmap](#12-migration-roadmap)

---

## 1. Executive Summary

### 1.1 Problem Statement

ARA Group (Euromobilia, Paneltech, Multiclamp) runs treasury operations across **12+ Excel workbooks** with 10,000+ formulas, manual email workflows, and a legacy ERP (PcGraf/siawin0) with 40+ SQL Server tables. Critical business processes — cashflow forecasting, payment prioritization, collections management, FX exposure, project milestone billing, MRP purchasing — all live in disconnected spreadsheets with no audit trail, no real-time visibility, and no transactional integrity.

### 1.2 Target State

A **fully transactional, read/write TMS platform** that:

- **Replaces** all Excel-based treasury workflows with governed, auditable transactions
- **Virtualizes** data across PcGraf ERP (SQL Server), Supabase (PostgreSQL), Excel legacy files, and external APIs into a single unified query layer
- **Provides** SunGard Quantum-class modules: Cash Management, Payments (CxP), Collections (CxC), FX/Risk, Project Finance, Invoicing, Bank Reconciliation, Debt Management, MRP/Procurement, and Board Reporting
- **Embeds** AI at every layer: predictive cashflow, anomaly detection, auto-classification, natural language queries, and intelligent workflow automation
- **Enforces** ACID transactions with full audit trail, maker-checker approvals, and role-based access

### 1.3 Business Units

| Code | Name | Primary Activity |
|------|------|-----------------|
| `EUROMOBILIA` | Euromobilia | Furniture manufacturing & distribution |
| `PANELTECH` | Paneltech | Panel systems & office solutions |
| `MULTICLAMP` | Multiclamp | Industrial clamping & hardware |

---

## 2. System Overview

### 2.1 Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                                │
│  React/Vite SPA · Vercel · TailwindCSS · Recharts · Lucide         │
│  treasury-copilot.vercel.app                                        │
├─────────────────────────────────────────────────────────────────────┤
│                    AI ORCHESTRATION LAYER                            │
│  LangGraph Agents (Modal) · FAISS KB · LangSmith Tracing           │
│  Root Agent → Analytics Agent → Data Service Agent                  │
├─────────────────────────────────────────────────────────────────────┤
│                    API GATEWAY LAYER                                 │
│  Starlette/Uvicorn (Modal) · RESTful + SSE (AG-UI)                 │
│  /tms/* (transactional) · /bi/* (analytics) · /ai/* (agents)       │
├─────────────────────────────────────────────────────────────────────┤
│                    BUSINESS LOGIC LAYER                              │
│  Transaction Engine · Workflow Engine · Rules Engine · Calc Engine  │
│  Maker-Checker · Approval Chains · STP (Straight-Through)          │
├─────────────────────────────────────────────────────────────────────┤
│                    DATA VIRTUALIZATION LAYER                         │
│  Unified Query Router · Federated Views · Cache (Redis/in-memory)  │
│  PcGraf Adapter · Supabase Adapter · Excel Adapter · API Adapter   │
├─────────────────────────────────────────────────────────────────────┤
│                    DATA PERSISTENCE LAYER                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Supabase │  │ PcGraf   │  │ Kafka    │  │ FAISS    │           │
│  │ (Write)  │  │ ERP (R)  │  │ CDC      │  │ KB       │           │
│  │ PostgreSQL│  │ SQL Srvr │  │ Events   │  │ Vectors  │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Technology Decisions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| **Frontend** | React 18 + Vite + TailwindCSS | Fast dev cycle, modern DX, existing codebase |
| **Hosting (FE)** | Vercel | Auto-deploy from Git, edge CDN, zero-config |
| **Backend** | Python/Starlette on Modal | Serverless, auto-scale, GPU for AI |
| **Primary DB** | Supabase (PostgreSQL) | Full ACID, RLS, realtime, edge functions |
| **Legacy ERP** | PcGraf/siawin0 (SQL Server) | Read-only via pymssql proxy, CDC sync |
| **Event Bus** | Kafka (Strimzi on AKS) | CDC streaming, event sourcing, replay |
| **AI** | LangGraph + OpenRouter + FAISS | Multi-agent, tool-calling, RAG |
| **Charts** | Recharts + D3 | Rich, interactive, composable |

---

## 3. Data Virtualization Layer

The **Data Virtualization Layer (DVL)** is the architectural centerpiece. It presents a **single, unified API** over heterogeneous data sources, so modules never need to know where data physically resides.

### 3.1 Architecture

```
┌─────────────────────────────────────────────────┐
│           VIRTUAL DATA API                       │
│  GET  /vdata/{entity}                            │
│  GET  /vdata/{entity}/{id}                       │
│  POST /vdata/{entity}/query  (filter/sort/page)  │
│  POST /vdata/{entity}        (create — write)    │
│  PUT  /vdata/{entity}/{id}   (update — write)    │
│  DELETE /vdata/{entity}/{id} (soft-delete)        │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │         QUERY ROUTER & FEDERATION         │  │
│  │  - Route by entity → adapter              │  │
│  │  - Fan-out multi-source queries           │  │
│  │  - Merge, deduplicate, rank results       │  │
│  │  - Apply business rules & transforms      │  │
│  │  - Cache with TTL & invalidation          │  │
│  └───────────────────────────────────────────┘  │
├──────────┬──────────┬──────────┬────────────────┤
│ Supabase │ PcGraf   │ Excel/   │ External API   │
│ Adapter  │ Adapter  │ File     │ Adapter        │
│          │          │ Adapter  │                │
│ R/W      │ R-only   │ R-only   │ R-only         │
│ (primary │ (legacy  │ (legacy  │ (BCCR FX,      │
│  store)  │  ERP)    │  rules)  │  Hacienda,     │
│          │          │          │  banks)        │
└──────────┴──────────┴──────────┴────────────────┘
```

### 3.2 Data Source Registry

| Source | Type | Access | Entities Served | Sync |
|--------|------|--------|----------------|------|
| **Supabase** (tms.*) | PostgreSQL | R/W | All canonical TMS entities | Primary store |
| **Supabase** (silver_finance.*) | PostgreSQL | R/W | CxP items, Flujo, MRP, CxC, Projections | Write-back |
| **PcGraf siawin0** | SQL Server | Read-only | FA00/01/12/20, CP10/11/12/21/31, CC10, IN04/11/13/14, BA10, CO00, HO* | CDC every 5min |
| **Excel files** (doc/) | Files | Read-only | Business rules, historical data, formulas | One-time import + reference |
| **BCCR** | REST API | Read-only | Exchange rates (USD/CRC) | Daily |
| **Hacienda CR** | REST API | Read-only | Tax validation, CABYS | On-demand |
| **Bank APIs** | REST/SFTP | Read-only | Bank statements, balances | Scheduled |

### 3.3 Entity Resolution & Conflict Strategy

When the same entity exists in multiple sources (e.g., a client in both PcGraf.FA20 and Supabase tms.clientes):

1. **Supabase is the canonical write store** — all mutations go here
2. **PcGraf is the system of record for ERP-originated data** — CDC syncs → Supabase
3. **Conflict resolution**: Last-write-wins with `_cdc_seq` ordering; user-curated fields (`_curated=true`) are never overwritten by CDC
4. **Excel data**: Imported once, then governs via business rules engine (not raw data)

### 3.4 Caching Strategy

| Cache Tier | Scope | TTL | Invalidation |
|-----------|-------|-----|-------------|
| **L1: In-memory** (Python dict) | Hot entities (FX rates, plan cuentas) | 60s | CDC event, manual |
| **L2: Supabase materialized views** | Aggregates (aging, portfolio) | 5min | CDC trigger |
| **L3: FAISS KB** | Semantic search embeddings | 4min auto-sync | CDC refresh endpoint |

---

## 4. Module Architecture

### 4.0 Module Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                       ARA TMS — MODULE MAP                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ M1: CASH    │  │ M2: PAYMENTS │  │ M3: COLLECT- │               │
│  │ MANAGEMENT  │  │ (CxP)        │  │ IONS (CxC)   │               │
│  │             │  │              │  │              │               │
│  │ · Position  │  │ · AP Ledger  │  │ · AR Ledger  │               │
│  │ · Forecast  │  │ · Approval   │  │ · Aging      │               │
│  │ · Liquidity │  │ · Scheduling │  │ · Dunning    │               │
│  │ · Pooling   │  │ · Execution  │  │ · Allocation │               │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                │                  │                        │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴───────┐               │
│  │ M4: FX &    │  │ M5: PROJECT  │  │ M6: INVOIC-  │               │
│  │ RISK MGMT   │  │ FINANCE      │  │ ING & E-BILL │               │
│  │             │  │              │  │              │               │
│  │ · Exposure  │  │ · Contracts  │  │ · Proformas  │               │
│  │ · Hedging   │  │ · Milestones │  │ · Facturas   │               │
│  │ · VaR       │  │ · Gantt      │  │ · E-Factura  │               │
│  │ · Scenarios │  │ · Billing    │  │ · CABYS      │               │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                │                  │                        │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴───────┐               │
│  │ M7: BANK    │  │ M8: DEBT &   │  │ M9: MRP /    │               │
│  │ RECONCIL.   │  │ OPERATIONS   │  │ PROCUREMENT  │               │
│  │             │  │              │  │              │               │
│  │ · Statement │  │ · Loans      │  │ · Demand     │               │
│  │ · Matching  │  │ · Credit     │  │ · Reorder    │               │
│  │ · Exceptions│  │ · Schedules  │  │ · EOQ/ABC    │               │
│  │ · GL Post   │  │ · Covenants  │  │ · Suppliers  │               │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                │                  │                        │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴───────┐               │
│  │ M10: BOARD  │  │ M11: AI      │  │ M12: ADMIN   │               │
│  │ REPORTING   │  │ COPILOT      │  │ & CONFIG     │               │
│  │             │  │              │  │              │               │
│  │ · Executive │  │ · Chat NLQ   │  │ · Users/RBAC │               │
│  │ · BU P&L    │  │ · Anomaly    │  │ · Workflows  │               │
│  │ · Variance  │  │ · Predict    │  │ · Rules      │               │
│  │ · Slides    │  │ · Automate   │  │ · Audit Log  │               │
│  └─────────────┘  └──────────────┘  └──────────────┘               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 M1: Cash Management

**Purpose**: Real-time global cash position, liquidity forecasting, and cash pooling across all BUs.

**Current state** (Excel → TMS):
- `Flujo por Unidad de Negocio.xlsx` → 4 sheets (Euromobilia, Paneltech, Multiclamp, Otras) with 1585 formulas each; columns are weekly periods with "Ejecutado"/"Proyectado" toggle
- `Flujo y Operaciones JD.xlsx` → Consolidated board view with loan schedules
- `01. Operaciones Bancarias.xlsx` → Bank operations register
- `Control de Operaciones.xlsx` → Manual operation tracking

**Business Rules to Bake In**:
- Weekly cashflow = Σ(Inflows by BU) − Σ(Outflows by BU) per week
- Each week column is either "Ejecutado" (actual) or "Proyectado" (forecast) — controlled by row 10/11 toggle
- BU allocation defaults to 25% each (dim.allocation_rules)
- Payment priority calendar drives Monday-first payment scheduling
- Bank operations tracked by: Compañía, Tipo (Largo Plazo/Capital Trabajo), Moneda, Banco

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Cash Position Dashboard | R | Real-time cash balances across all bank accounts, BUs, currencies |
| Cash Forecast Engine | R/W | 4/8/12/52-week rolling forecast with actuals overlay |
| Liquidity Gap Analysis | R | Maturity ladder: inflows vs outflows by bucket (1d, 1w, 2w, 1m, 3m, 6m, 12m) |
| Cash Pooling | R/W | Notional pooling across BU accounts; sweep rules |
| What-If Scenarios | R/W | Create/save/compare alternative cashflow scenarios |
| Daily Cash Report | R | Auto-generated PDF for management |

**Data Sources**: Supabase `silver_finance.flujo_semanal`, PcGraf `BA10`, bank APIs, `tms.movimientos_bancarios`

---

### 4.2 M2: Payments / CxP (Cuentas por Pagar)

**Current state** (Excel → TMS):
- `GV CXP Totales.xlsx` → Master payables register with Empresa, Negocio, Responsable, Prioridad, Monto USD, Proveedor, Clasificación
- Manual email from CxP → Tesorería with Excel attachment
- SharePoint: Factura + OC scanned for gerencia approval
- Priority system: "1 URGE", "1", "No Proceder", etc.

**Business Rules to Bake In**:
- Priority codes: `1 URGE` (pay immediately), `1` (pay this cycle), `2` (next cycle), `No Proceder` (hold)
- Payment cycles: Weekly, aligned to Monday priority calendar
- Multi-BU: Each payable is tagged to Empresa + Negocio
- Approval chain: Responsable → Gerencia → Tesorería
- Tarjetas de crédito: treated as proveedor-banco with same CxP flow
- Comisiones: Gerencia sends Tuesday/Wednesday → manual calc → nómina → tesorería
- Importaciones: Manual Excel with aranceles, shared folder

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| AP Ledger | R/W | Full payables register synced from PcGraf CP21 + Excel CxP |
| Invoice Receipt | W | Capture vendor invoices from Hacienda/Almamater |
| 3-Way Matching | R/W | Auto-match PO (CP10) ↔ Receipt (CP12) ↔ Invoice (CP21) |
| Payment Approval Workflow | R/W | Maker-checker with priority-based routing |
| Payment Scheduling | R/W | Weekly payment plan by priority, BU, and available cash |
| Payment Execution | W | Generate SINPE/wire instructions, mark as paid |
| Vendor Portal View | R | Self-service vendor payment status (future) |
| Aging Analysis | R | 30/60/90/120+ day buckets by vendor, BU, classification |

**Data Sources**: PcGraf `CP10, CP11, CP12, CP21, CP31`, Supabase `silver_finance.cxp_items`, `tms.cuentas_por_pagar`

---

### 4.3 M3: Collections / CxC (Cuentas por Cobrar)

**Current state** (Excel → TMS):
- `PROYECTOS/Analisis cartera.xlsx` → Aging analysis with Resumen sheets per month
- `PROYECTOS/tabla cobros.xlsx` → Collection tracking with BD sheet, pivot tables, Estado field
- 4 commercial areas, each with a gestor de cobro
- Weekly cartera pass based on vencimiento date
- Categories: Normal, Cartera Morosa (1-1000 days overdue), Adelanto Proyectos

**Business Rules to Bake In**:
- Aging buckets: Current, 1-30, 31-60, 61-90, 91-120, 121-180, 180+
- Collection assignment by area_comercial → gestor_cobro
- Weekly handoff: overdue invoices move to collection queue each Monday
- Depuración: Batch purge at 90+ days; real-time purge at 60 days
- Formulas: `variance = monto_contrato - cobrado`, `ratio = cobrado / facturado`
- Monthly collection targets per gestor with actual vs target tracking

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| AR Ledger | R/W | Full receivables register synced from PcGraf CC10 + manual |
| Aging Dashboard | R | Real-time aging by client, area, gestor with drill-down |
| Collection Worklist | R/W | Prioritized queue per gestor, sorted by amount × days overdue |
| Dunning Automation | R/W | Auto-generate reminder letters at 30/60/90 days |
| Payment Application | W | Apply received payments to open invoices |
| Credit Memo Processing | W | Create and apply NC for retenciones, devoluciones, FX diffs |
| DSO Analytics | R | Days Sales Outstanding trends by BU, client, product line |
| Promise-to-Pay | R/W | Record and track customer payment commitments |

**Data Sources**: PcGraf `CC10, CC12, FA12, FA20`, Supabase `silver_finance.cxc_items`, `tms.cuentas_por_cobrar`

---

### 4.4 M4: FX & Risk Management

**Current state**: Exchange rates from BCCR; `cTipo_Cambio_Sistema` in FA00; manual FX exposure tracking; CRC/USD dual currency everywhere.

**Business Rules to Bake In**:
- Base currencies: CRC (colones), USD (dollars)
- FX source: BCCR daily compra/venta rates
- Exposure = Σ(USD receivables) − Σ(USD payables) − Σ(USD debt)
- PcGraf stores `cTipo_Cambio_Sistema` and `cTipo_Cambio_Proyectado` per invoice
- Differential cambiario (FX gain/loss) flows to NC in CxC module

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| FX Position Monitor | R | Real-time net FX exposure by BU and currency |
| Rate Feed | R | Auto-fetch BCCR rates; historical trend charts |
| Revaluation Engine | R/W | Mark-to-market open positions; post FX gain/loss |
| Hedge Tracker | R/W | Record forwards, options; track hedge effectiveness |
| VaR Calculator | R | Value-at-Risk on open FX positions (parametric + historical) |
| Scenario Simulator | R/W | What-if on rate movements; stress testing |

**Data Sources**: BCCR API, PcGraf `TC`, Supabase `tms.tipos_cambio`

---

### 4.5 M5: Project Finance

**Current state** (Excel → TMS):
- `PROYECTOS/ContratosMain.xlsx` → 207 formulas; columns: Contract, Client, Monto, Facturado, Cobrado, Pendiente = `L-M`, Saldo = `L-O`
- `PROYECTOS/proyecc.xlsx` → Cash collection projections by project
- `PROYECTOS/tabla cobros.xlsx` → Detailed collections by contract with monthly Resumen sheets
- PcGraf: HO00/HO01/HO03/HO05 (contract system), IM00 (imported documents), FA00.sProyecto links invoices to projects

**Business Rules to Bake In**:
- Contract lifecycle: Propuesta → Negociación → Firmado → En Ejecución → Cerrado
- Milestone states: Pendiente → Facturado → Cobrado → Cerrado
- Pending = Monto_Contrato − Facturado
- Saldo = Monto_Contrato − Cobrado
- Collection ratio = Cobrado / Facturado
- Milestone alerts: 7 days, 14 days, 30 days before effective date
- Adelanto de proyecto = advance payment type in CxC

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Contract Register | R/W | Full CRUD on project contracts with lifecycle management |
| Milestone Tracker | R/W | Define, track, and bill contract milestones |
| Gantt Timeline | R | Visual timeline with milestone alerts (7d/14d/30d) |
| Project P&L | R | Revenue recognition, cost tracking, margin analysis per project |
| Collection Forecast | R | Project-level cash collection schedule |
| Budget vs Actual | R | Variance analysis by contract |
| Area Breakdown | R | Portfolio view by commercial area / project type |

**Data Sources**: PcGraf `HO00, HO01, HO03, HO05, IM00, FA00`, Supabase (new `tms.contratos`, `tms.hitos_contrato`), Excel files

---

### 4.6 M6: Invoicing & Electronic Billing

**Current state**: PcGraf generates proformas (FA00 bProforma=1) → converted to facturas → Almamater for electronic invoice → Hacienda validation. CABYS codes mandatory.

**Business Rules to Bake In**:
- Invoice types: FA (Factura), NC (Nota Crédito), ND (Nota Débito), Proforma
- Flow: Proforma → Factura → E-Factura (Almamater) → Hacienda → Accepted/Rejected
- CABYS code required on every line item
- iTipo_Moneda: 1=CRC, 2=USD
- bForma_Pago: 1=Crédito, 0=Contado
- Descuento structure: Line-level % + Gold discount + Pactado discounts

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Invoice Browser | R | Search, filter, drill-down into FA00/FA01 |
| Invoice Creator | W | Create proformas/invoices from contract milestones or manual |
| E-Invoice Status | R | Track Hacienda acceptance/rejection status |
| Credit Memo | W | Generate NC for returns, FX diffs, retenciones |
| Revenue Recognition | R/W | Multi-period revenue allocation per accounting standards |
| Top Clients Dashboard | R | Pareto analysis, client concentration risk |

**Data Sources**: PcGraf `FA00, FA01, FA12, FA20, FA25, FA50`, Supabase `tms.facturas, tms.lineas_factura`

---

### 4.7 M7: Bank Reconciliation

**Current state**: Manual conciliation in PcGraf. Daily bank statements vs ERP movements. Tesorería matches receipts to invoices.

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Statement Import | W | Upload/fetch bank statements (CSV, MT940, API) |
| Auto-Matching | R/W | AI-powered matching: bank txn ↔ ERP payment/receipt |
| Exception Queue | R/W | Unmatched items for manual resolution |
| GL Posting | W | Post reconciled items to general ledger |
| Bank Balance Monitor | R | Real-time balances across all bank accounts |

**Data Sources**: Bank files, PcGraf `BA10, BA11`, Supabase `tms.movimientos_bancarios`

---

### 4.8 M8: Debt & Operations Management

**Current state**: `Flujo y Operaciones JD.xlsx` → 203 formulas tracking loans, credit lines, interest, amortization schedules. Columns: Saldo Original, Principal, Intereses, Cuota, Capital Actualizado. `02. Flujo Semanal Operaciones.xlsx` → weekly operation tracking.

**Business Rules to Bake In**:
- Debt types: Largo Plazo (long-term), Capital de Trabajo (working capital)
- Each operation: Compañía, Tipo, Banco, Moneda, Vencimiento
- Capital actualizado = Saldo original − Σ(pagos principal)
- Cuota = Principal + Intereses
- `BD Proyecciones` sheet: projected future payments

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Loan Register | R/W | All credit facilities, terms, rates, covenants |
| Amortization Schedules | R | Auto-generated payment schedules per instrument |
| Interest Calculator | R | Accrued interest computation by period |
| Covenant Monitor | R | Track financial covenants, alert on breach |
| Maturity Profile | R | Debt maturity ladder visualization |
| Refinancing Simulator | R/W | What-if on rate changes, restructuring options |

**Data Sources**: Supabase (new `tms.debt_instruments`, `tms.debt_schedules`), Excel operations files

---

### 4.9 M9: MRP / Procurement

**Current state**: `MRP Planning V2.xlsx` → 4,986 formulas across 8+ sheets. Main MRP sheet with 30,000+ rows. VLOOKUPs to ABC Analysis, Proveedores, Consumos (8 months), OC en Tránsito (31-column sum). Alert logic: stock < punto_reorden → `Hacer Pedido = Si`.

**Business Rules to Bake In**:
- ABC Classification: A (80% of value), B (15%), C (5%) — cumulative % of spend
- EOQ (Economic Order Quantity) = √(2·D·S / H) — Wilson model
- Safety Stock = Z × σ × √(LT) where Z=1.65 for 95% service level
- Reorder Point = (consumo_diario × lead_time) + safety_stock
- Días cobertura = inventario_disponible / consumo_diario
- Alerta Desabasto: trigger when días_cobertura < lead_time_dias
- 8-month rolling consumption with standard deviation for demand volatility

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| MRP Dashboard | R | Inventory position, stockout alerts, reorder recommendations |
| Demand Forecasting | R | ML-based demand prediction using historical consumption |
| Purchase Requisition | W | Auto-generate PR from reorder point triggers |
| Supplier Scorecard | R | Lead time, quality, price variance tracking |
| ABC/XYZ Analysis | R | Cross-classification matrix for inventory strategy |
| Import vs Local | R | Strategic sourcing comparison by origin |

**Data Sources**: PcGraf `IN04, IN11, IN13, IN14, IN42, CP10, CP11`, Supabase `silver_finance.mrp_master, tms.productos`

---

### 4.10 M10: Board Reporting

**Current state**: `Flujo y Operaciones JD.xlsx` → `Consolidado JD` sheet with 236 formulas. Board sees: consolidated cash position, debt status, BU P&L, Ejecutado vs Proyectado toggle.

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Executive Dashboard | R | Single-pane: cash, debt, CxP, CxC, FX, alerts |
| BU Comparison | R | Side-by-side performance by business unit |
| Variance Report | R | Budget vs Actual with drill-down |
| Presentation Mode | R | Full-screen slides for board meetings |
| Scheduled Reports | R/W | Auto-email PDF/Excel to stakeholders |
| Custom KPI Builder | R/W | Define and track custom metrics |

---

### 4.11 M11: AI Copilot

**Current state**: LangGraph multi-agent system with FAISS KB, tool-calling, and natural language queries.

**TMS Features**:

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| Natural Language Query | R | "What's our CxP exposure to USD vendors over 90 days?" |
| Anomaly Detection | R | Flag unusual transactions, late payments, FX spikes |
| Cashflow Prediction | R | ML-driven 4/8/12-week cashflow forecast |
| Auto-Classification | R/W | AI classifies new payables by priority, GL account |
| Workflow Suggestions | R | "You have 3 invoices ready to pay that match this PO" |
| Document Extraction | R/W | Parse vendor invoices, bank statements via OCR/LLM |
| Meeting Prep | R | Auto-generate board meeting summary from latest data |

---

### 4.12 M12: Admin & Configuration

| Feature | Read/Write | Description |
|---------|-----------|-------------|
| User Management | R/W | RBAC: admin, finance_manager, treasury_analyst, viewer |
| Business Unit Config | R/W | CRUD on BUs, allocation rules, GL mapping |
| Workflow Designer | R/W | Define approval chains, escalation rules, STP criteria |
| Business Rules Manager | R/W | Modify calc formulas, thresholds, priorities without code |
| Audit Trail | R | Immutable log of every transaction and configuration change |
| CDC Monitor | R | Real-time status of PcGraf → Supabase data sync |
| System Health | R | API latency, error rates, Kafka lag, KB freshness |

---

## 5. Canonical Data Model

### 5.1 Entity Relationship Overview

```
┌────────────────┐     ┌──────────────┐     ┌───────────────┐
│  dim.business  │     │ tms.clientes │     │tms.proveedores│
│    _units      │     │   (FA20)     │     │   (IN13)      │
└───────┬────────┘     └──────┬───────┘     └──────┬────────┘
        │                     │                     │
   ┌────┴────┐          ┌─────┴─────┐         ┌────┴─────┐
   │All TMS  │          │tms.factu- │         │tms.orde- │
   │entities │          │  ras      │         │nes_compra│
   │have BU  │          │  (FA12)   │         │  (CP10)  │
   └─────────┘          └─────┬─────┘         └────┬─────┘
                              │                     │
                        ┌─────┴─────┐         ┌────┴──────┐
                        │tms.lineas │         │tms.lineas │
                        │ _factura  │         │  _oc      │
                        │  (FA01)   │         │  (CP11)   │
                        └─────┬─────┘         └────┬──────┘
                              │                     │
                        ┌─────┴─────┐         ┌────┴──────┐
                        │tms.cuentas│         │tms.cuentas│
                        │_por_cobrar│         │_por_pagar │
                        │  (CC10)   │         │  (CP21)   │
                        └───────────┘         └───────────┘

┌────────────────┐     ┌──────────────┐     ┌───────────────┐
│tms.contratos   │     │tms.hitos_    │     │tms.movimien-  │
│  (NEW)         │────▶│ contrato     │     │tos_bancarios  │
│                │     │  (NEW)       │     │  (BA10)       │
└────────────────┘     └──────────────┘     └───────────────┘

┌────────────────┐     ┌──────────────┐     ┌───────────────┐
│tms.debt_       │     │tms.debt_     │     │tms.cashflow_  │
│ instruments    │────▶│ schedules    │     │ forecast      │
│  (NEW)         │     │  (NEW)       │     │  (NEW)        │
└────────────────┘     └──────────────┘     └───────────────┘
```

### 5.2 New Entities Required (not yet in schema)

| Entity | Table | Purpose |
|--------|-------|---------|
| **Contratos** | `tms.contratos` | Project contracts with lifecycle tracking |
| **Hitos de Contrato** | `tms.hitos_contrato` | Milestones per contract (billing schedule) |
| **Debt Instruments** | `tms.debt_instruments` | Loans, credit lines, bonds |
| **Debt Schedules** | `tms.debt_schedules` | Amortization table per instrument |
| **Cashflow Forecast** | `tms.cashflow_forecast` | Weekly forecast entries (actual + projected) |
| **Cashflow Scenarios** | `tms.cashflow_scenarios` | Named what-if scenario containers |
| **Payment Batches** | `tms.payment_batches` | Grouped payments for approval/execution |
| **Payment Instructions** | `tms.payment_instructions` | Individual wire/SINPE instructions |
| **Approval Workflows** | `tms.approval_workflows` | Configurable approval chains |
| **Approval Steps** | `tms.approval_steps` | Individual approval actions (approve/reject) |
| **Bank Statements** | `tms.bank_statements` | Imported bank statement headers |
| **Bank Statement Lines** | `tms.bank_statement_lines` | Individual bank transactions |
| **Reconciliation Matches** | `tms.recon_matches` | Bank txn ↔ ERP txn matches |
| **FX Positions** | `tms.fx_positions` | Open FX exposure positions |
| **FX Hedges** | `tms.fx_hedges` | Forward contracts, options |
| **Business Rules** | `tms.business_rules` | Configurable rules (thresholds, formulas) |
| **Audit Log** | `tms.audit_log` | Immutable transaction audit trail |
| **Notifications** | `tms.notifications` | User notification queue |
| **Report Templates** | `tms.report_templates` | Saved report configurations |

### 5.3 Common Entity Patterns

Every transactional entity follows this pattern:

```sql
CREATE TABLE tms.{entity} (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Traceability
  _pcgraf_pk        text,                   -- Original ERP PK (if synced)
  _synced_at        timestamptz,            -- Last CDC sync timestamp
  _cdc_seq          bigint DEFAULT 0,       -- CDC sequence for conflict resolution
  _curated          boolean DEFAULT false,  -- User-edited (protects from CDC overwrite)
  _curated_by       text,
  _curated_at       timestamptz,
  -- Business fields ...
  -- Multi-tenancy
  empresa           text,                   -- BU code
  -- Audit
  created_by        text,
  created_at        timestamptz DEFAULT now(),
  updated_by        text,
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz,            -- Soft delete
  version           integer DEFAULT 1       -- Optimistic concurrency
);
```

---

## 6. Business Rules Engine

### 6.1 Rules Extracted from Excel

| Rule ID | Module | Source Excel | Formula/Logic | Implementation |
|---------|--------|-------------|---------------|----------------|
| BR-001 | Cash | Flujo BU | Week status = IF(row10="Ejecutado","Real","Proyectado") | `cashflow_forecast.status` enum |
| BR-002 | CxP | GV CXP | Priority: "1 URGE" → immediate, "1" → this cycle | `cxp_items.prioridad` + scheduling engine |
| BR-003 | CxP | GV CXP | BU allocation default = 25% per BU | `dim.allocation_rules.allocation_pct` |
| BR-004 | CxC | Cartera | Aging = GREATEST(0, today − vencimiento) | Materialized view `cxc_items_live` |
| BR-005 | CxC | Cobros | Collection variance = monto_contrato − cobrado | Computed column in `hitos_contrato` |
| BR-006 | CxC | Cobros | Collection ratio = cobrado / facturado | Computed in API response |
| BR-007 | Projects | ContratosMain | Pending = L (monto) − M (facturado) | `hitos_contrato.pendiente` computed |
| BR-008 | Projects | ContratosMain | Saldo = L (monto) − O (cobrado) | `hitos_contrato.saldo` computed |
| BR-009 | MRP | MRP V2 | ABC cumulative %: A < 80%, B < 95%, C = rest | `productos.abc_class` computed on sync |
| BR-010 | MRP | MRP V2 | Reorder = (consumo_diario × lead_time) + safety_stock | `productos.punto_reorden` |
| BR-011 | MRP | MRP V2 | Safety stock = 1.65 × σ × √(lead_time) | `productos.stock_seguridad` |
| BR-012 | MRP | MRP V2 | EOQ = √(2 × demand × order_cost / holding_cost) | Computed in procurement engine |
| BR-013 | MRP | MRP V2 | Stockout alert = días_cobertura < lead_time | Flag in MRP dashboard |
| BR-014 | Debt | Operaciones | Capital actualizado = saldo_original − Σ(pagos) | `debt_instruments.saldo_actual` |
| BR-015 | Debt | Operaciones | Cuota = principal + intereses | `debt_schedules.cuota` |
| BR-016 | FX | All | Exposure = Σ(USD AR) − Σ(USD AP) − Σ(USD debt) | Computed aggregate |
| BR-017 | Invoicing | PcGraf | E-invoice flow: Proforma → FA → Almamater → Hacienda | Status enum + webhook |
| BR-018 | CxC | Process | Depuración batch: purge > 90 days; RT purge > 60 days | Scheduled job + config threshold |
| BR-019 | CxP | Process | Comisiones: Tue/Wed → calc → nómina → tesorería | Workflow step definition |
| BR-020 | Cash | JD Consolidado | Ejecutado/Proyectado toggle per week drives real vs forecast | UI toggle → `status` field |

### 6.2 Rules Engine Design

```
┌────────────────────────────────────────────────┐
│              RULES ENGINE                       │
│                                                 │
│  tms.business_rules table:                      │
│  ┌─────────────────────────────────────────┐   │
│  │ rule_id   │ module  │ condition │ action │   │
│  │ BR-002    │ CxP     │ prioridad │ sched  │   │
│  │           │         │ = "1 URG" │ = now  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Evaluation:                                    │
│  1. On transaction CREATE/UPDATE                │
│  2. On scheduled job (cron)                     │
│  3. On API request (real-time)                  │
│                                                 │
│  Actions:                                       │
│  - Set field value                              │
│  - Create notification                          │
│  - Trigger workflow step                        │
│  - Block transaction (validation)               │
│  - Log to audit                                 │
└────────────────────────────────────────────────┘
```

---

## 7. AI & Analytics Layer

### 7.1 AI Agent Architecture

```
User (Chat/Action) ──▶ Root Treasury Agent (LangGraph)
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
           Analytics    Data Service   Tool Calls
           Agent        Agent          (direct)
           │            │              │
           ▼            ▼              ▼
        matplotlib   Supabase SQL   PcGraf proxy
        seaborn      CRUD ops       FX rates API
        forecasting  CDC triggers   Bank APIs
```

### 7.2 AI-Powered Features Per Module

| Module | AI Feature | Model/Technique |
|--------|-----------|----------------|
| M1 Cash | Cashflow prediction (4-52 week) | ARIMA + Gradient Boosting ensemble |
| M1 Cash | Anomaly detection on bank txns | Isolation Forest |
| M2 CxP | Auto-priority classification | LLM classification (few-shot) |
| M2 CxP | Invoice data extraction (OCR) | Vision LLM + structured output |
| M3 CxC | Collection probability scoring | Logistic regression on payment history |
| M3 CxC | Optimal dunning strategy | Reinforcement learning (future) |
| M4 FX | Rate forecast (short-term) | LSTM on BCCR historical |
| M5 Projects | Milestone delay prediction | Random Forest on historical milestones |
| M7 Recon | Auto-matching bank ↔ ERP | Fuzzy matching + LLM disambiguation |
| M9 MRP | Demand forecast | Prophet / exponential smoothing |
| M11 Chat | Natural language to SQL | LangChain SQL Agent with schema context |
| M11 Chat | Report generation | LLM summarization + chart generation |

### 7.3 FAISS Knowledge Base

The unified FAISS KB indexes:
- All Supabase tables (tms.*, silver_finance.*, dim.*)
- PcGraf ERP table metadata
- Excel business rules (extracted and embedded)
- Process documentation (CxP.docx, CxC y Facturación.docx)
- CDC events (incremental refresh every 4 minutes)

---

## 8. Transaction Processing

### 8.1 Write Path Architecture

```
Client (React) ──▶ POST /tms/{entity}
                        │
                        ▼
              ┌─────────────────────┐
              │  INPUT VALIDATION    │
              │  - Schema validation │
              │  - Business rules    │
              │  - Auth & RBAC       │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  WORKFLOW ENGINE     │
              │  - Approval required?│
              │  - STP eligible?     │
              │  - Maker-checker?    │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  TRANSACTION ENGINE  │
              │  - Supabase INSERT   │
              │  - Audit log entry   │
              │  - Kafka event pub   │
              │  - KB refresh notify │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  SIDE EFFECTS        │
              │  - Notifications     │
              │  - Downstream calcs  │
              │  - Report invalidate │
              │  - Push-to-ERP (opt) │
              └─────────────────────┘
```

### 8.2 Maker-Checker Flow

```
Maker (Analyst) creates transaction ──▶ status = 'PENDING_APPROVAL'
                                                │
Checker (Manager) reviews ──▶ APPROVE ──▶ status = 'APPROVED' ──▶ Execute
                           └─▶ REJECT ──▶ status = 'REJECTED' ──▶ Notify maker
                           └─▶ RETURN ──▶ status = 'RETURNED'  ──▶ Maker edits
```

### 8.3 Transaction Types

| Transaction | Module | Approval | STP Eligible | ERP Push |
|------------|--------|----------|-------------|----------|
| Record vendor invoice | CxP | Manager | Yes (< $500) | CP21 |
| Schedule payment | CxP | Treasury Head | No | — |
| Execute payment | CxP | Treasury + Finance | No | CP31 |
| Apply customer payment | CxC | Analyst | Yes (exact match) | CC12 |
| Create invoice | Invoicing | Sales + Finance | No | FA00/FA01 |
| Issue credit memo | CxC | Finance Manager | No | FA50 |
| Create contract | Projects | Project Manager | No | — |
| Record milestone | Projects | PM + Finance | No | — |
| Bank reconciliation | Recon | Analyst | Yes (auto-match) | BA10 |
| Update forecast | Cash | Analyst | No | — |
| FX hedge booking | FX | Treasury Head | No | — |

---

## 9. Integration Architecture

### 9.1 System Integration Map

```
┌──────────┐    CDC/5min    ┌──────────┐    Kafka    ┌──────────┐
│ PcGraf   │ ◀──────────── │  CDC     │ ──────────▶ │ Supabase │
│ siawin0  │   (read-only) │ Producer │             │ (tms.*)  │
│ SQL Srvr │               │ (AKS)   │             │          │
└──────────┘               └──────────┘             └──────────┘
                                                          │
┌──────────┐    REST API    ┌──────────┐    Realtime │
│ Almamater│ ◀──────────── │  Backend │ ◀──────────┘
│ (E-Fact) │               │  (Modal) │
└──────────┘               └──────┬───┘
                                  │
┌──────────┐    REST API          │          ┌──────────┐
│ BCCR     │ ◀────────────────────┤          │ Vercel   │
│ (FX)     │                      ├─────────▶│ (React)  │
└──────────┘                      │          └──────────┘
                                  │
┌──────────┐    SFTP/API          │
│ Banks    │ ◀────────────────────┘
│ (stmts)  │
└──────────┘
```

### 9.2 API Contract Summary

| Path Pattern | Method | Auth | Description |
|-------------|--------|------|-------------|
| `/tms/{entity}` | GET | Bearer | List with filter/sort/page |
| `/tms/{entity}/{id}` | GET | Bearer | Get by ID |
| `/tms/{entity}` | POST | Bearer | Create (write) |
| `/tms/{entity}/{id}` | PUT | Bearer | Update (write) |
| `/tms/{entity}/{id}` | DELETE | Bearer | Soft delete |
| `/bi/{module}/kpis` | GET | Bearer | Module KPIs |
| `/bi/{module}/chart/{name}` | GET | Bearer | Named chart data |
| `/workflow/approve/{id}` | POST | Bearer | Approve pending txn |
| `/workflow/reject/{id}` | POST | Bearer | Reject pending txn |
| `/ai/chat` | POST(SSE) | Bearer | AI chat streaming |
| `/ai/predict/{model}` | POST | Bearer | ML prediction |
| `/vdata/{entity}/query` | POST | Bearer | Virtual data query |
| `/erp/*` | GET | Bearer | PcGraf proxy (existing) |
| `/pcgraf/*` | POST/GET | Bearer | Legacy raw SQL proxy |

---

## 10. Security & Audit

### 10.1 Authentication & Authorization

| Layer | Mechanism |
|-------|----------|
| **Frontend** | Supabase Auth (email/password, SSO future) |
| **API** | JWT Bearer tokens (Supabase-issued) |
| **Database** | Supabase RLS policies per role per table |
| **PcGraf** | Service account (server-side only, never exposed) |

### 10.2 Role-Based Access Control

| Role | M1 Cash | M2 CxP | M3 CxC | M4 FX | M5 Projects | M6 Invoice | M7 Recon | M8 Debt | M9 MRP | M10 Board | M11 AI | M12 Admin |
|------|---------|--------|--------|-------|------------|-----------|---------|---------|--------|----------|--------|-----------|
| admin | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W |
| finance_manager | R/W | R/W (approve) | R/W (approve) | R/W | R/W | R/W | R/W | R/W | R | R/W | R/W | R |
| treasury_analyst | R/W | R/W (create) | R/W (create) | R | R | R | R/W | R | R | R | R/W | — |
| viewer | R | R | R | R | R | R | R | R | R | R | R | — |

### 10.3 Audit Trail

Every write operation produces an immutable audit record:

```sql
tms.audit_log (
  id, timestamp, user_id, user_role, ip_address,
  action,       -- 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT'
  entity_type,  -- 'cxp_payment', 'invoice', 'contract', etc.
  entity_id,
  old_values,   -- JSONB snapshot before change
  new_values,   -- JSONB snapshot after change
  metadata      -- module, workflow_id, approval_step, etc.
)
```

---

## 11. Deployment & Infrastructure

### 11.1 Current Infrastructure

| Component | Provider | Status |
|-----------|----------|--------|
| Frontend | Vercel (treasury-copilot.vercel.app) | ✅ Live |
| Backend/AI Agents | Modal (3 deployments) | ✅ Live |
| Primary Database | Supabase (PostgreSQL) | ✅ Live |
| Legacy ERP | PcGraf siawin0 (on-prem SQL Server 192.168.1.3) | ✅ Live |
| Event Bus | Kafka on AKS (Strimzi, 3 brokers) | ✅ Live |
| CDC Pipeline | AKS CronJob (producer) + Deployment (consumer) | ✅ Live |
| Container Registry | Azure ACR (cr6uluhllxv7asm) | ✅ Live |

### 11.2 Target Infrastructure (No Changes Required)

The current infrastructure supports the full TMS vision. Key enhancements:

1. **Supabase**: Add new tables (Section 5.2) via migrations
2. **Modal**: Extend `server.py` with new `/tms/*` endpoints + transaction engine
3. **Vercel**: New frontend pages/components per module
4. **Kafka**: Existing 24 CDC topics + new event topics for write operations
5. **PcGraf**: Read-only access continues via existing proxy; optional write-back for select operations

---

## 12. Migration Roadmap

### Phase 1: Foundation (Weeks 1-3)
- [ ] Create new Supabase migration with all Section 5.2 entities
- [ ] Build Data Virtualization Layer (query router, adapters)
- [ ] Build Transaction Engine (validation, audit, workflow skeleton)
- [ ] Extend RBAC with per-module permissions

### Phase 2: Core Modules (Weeks 4-8)
- [ ] **M1 Cash Management**: Replace `Flujo por BU` Excel with forecast engine
- [ ] **M2 CxP Payments**: Replace `GV CXP Totales` Excel with AP ledger + approval workflows
- [ ] **M3 CxC Collections**: Replace `tabla cobros` / `Analisis cartera` with AR ledger + aging
- [ ] **M6 Invoicing**: Enhance existing ERP browser with create/edit capabilities

### Phase 3: Advanced Modules (Weeks 9-14)
- [ ] **M5 Project Finance**: Replace `ContratosMain` with contract/milestone lifecycle
- [ ] **M4 FX & Risk**: Build exposure monitor, hedge tracker, VaR
- [ ] **M8 Debt Management**: Replace `Operaciones` Excel with loan register
- [ ] **M7 Bank Reconciliation**: Build statement import + auto-matching

### Phase 4: Intelligence & Polish (Weeks 15-20)
- [ ] **M9 MRP**: Enhance existing ComprasDashboard with write capabilities
- [ ] **M10 Board Reporting**: Presentation mode, scheduled PDF reports
- [ ] **M11 AI Copilot**: Anomaly detection, cashflow prediction, auto-classification
- [ ] **M12 Admin**: Rules manager, workflow designer, full audit UI

### Phase 5: Optimization (Ongoing)
- [ ] Performance tuning (materialized views, query optimization)
- [ ] Mobile-responsive UI refinements
- [ ] Bank API integrations (statement feeds, payment initiation)
- [ ] Almamater e-invoice integration
- [ ] Push-to-PcGraf for select write-back operations

---

## Appendix A: Excel Files Inventory

| File | Sheets | Formulas | Key Columns | TMS Module |
|------|--------|----------|-------------|-----------|
| `GV CXP Totales 02-02-2026.xlsx` | 1 | 0 (data) | Empresa, Negocio, Prioridad, Monto USD, Proveedor | M2 CxP |
| `Flujo por Unidad de Negocio.xlsx` | 5 | ~6,300 | Weekly periods, Ejecutado/Proyectado, BU cashflows | M1 Cash |
| `Flujo y Operaciones JD.xlsx` | 6+ | ~700 | Operaciones, BD Proyecciones, Consolidado JD | M1/M8/M10 |
| `01. Operaciones Bancarias.xlsx` | 1 | ? | Bank operations register | M7/M8 |
| `02. Flujo Semanal Operaciones.xlsx` | 1+ | 52+ | Weekly operations tracking | M1/M8 |
| `Control de Operaciones.xlsx` | 1+ | ? | Operation tracking | M8 |
| `MRP Planning V2.xlsx` | 8+ | 4,986 | 30K+ SKUs, ABC, consumption, reorder | M9 MRP |
| `PROYECTOS/ContratosMain.xlsx` | 1 | 207 | Contract, Monto, Facturado, Cobrado, Pendiente, Saldo | M5 Projects |
| `PROYECTOS/tabla cobros.xlsx` | 7 | 121 | BD collections, monthly Resumen, pivot by Estado | M3/M5 |
| `PROYECTOS/Analisis cartera.xlsx` | 1 | 1 | Aging resumen by period | M3 CxC |
| `PROYECTOS/proyecc.xlsx` | 1 | 0 | Cash collection projection by project | M5 Projects |

## Appendix B: PcGraf ERP Table Map

| Table | Module | Rows | TMS Entity | CDC |
|-------|--------|------|-----------|-----|
| FA00 | Facturación | 33K | `tms.facturas` (header) | ✅ |
| FA01 | Facturación | 59K | `tms.lineas_factura` | ✅ |
| FA12 | Facturación | — | `tms.facturas` (alt header) | ✅ |
| FA20 | Facturación | — | `tms.clientes` | ✅ |
| FA25 | Facturación | — | `tms.recibos_caja` | ✅ |
| FA50 | Facturación | — | `tms.notas_credito` | — |
| CP10 | Compras | — | `tms.ordenes_compra` | ✅ |
| CP11 | Compras | — | `tms.lineas_oc` | ✅ |
| CP12 | Compras | — | `tms.recepciones_compra` | ✅ |
| CP21 | Compras | — | `tms.cuentas_por_pagar` | ✅ |
| CP31 | Compras | — | `tms.pagos_proveedores` | ✅ |
| CC10 | CxC | — | `tms.cuentas_por_cobrar` | ✅ |
| IN04 | Inventario | 31K | `tms.productos` | ✅ |
| IN13 | Inventario | — | `tms.proveedores` | ✅ |
| IN14 | Inventario | — | `tms.inventario_bodega` | ✅ |
| BA10 | Bancos | — | `tms.movimientos_bancarios` | ✅ |
| CO00 | Contabilidad | — | `tms.plan_cuentas` | ✅ |
| TC | General | — | `tms.tipos_cambio` | ✅ |
| HO00 | Contratos | ? | `tms.contratos` | Pending |
| HO01 | Contratos | ? | `tms.hitos_contrato` | Pending |
| HO03 | Contratos | ? | `tms.hitos_contrato` | Pending |
| HO05 | Contratos | ? | `tms.hitos_contrato` | Pending |
| IM00 | Documentos | 0 | `tms.documentos_proyecto` | — |

---

*This document is the living architectural blueprint for the ARA TMS platform. All implementation work should reference this document for scope, design decisions, and business rules.*
