"""
TMS Core Module Analytics API
Phase 2: M1 Cash, M2 CxP, M3 CxC, M6 Invoicing.
Phase 3: M5 Project Finance, M4 FX & Risk, M8 Debt Management, M7 Bank Reconciliation.

These go beyond basic CRUD (handled by tms_engine.py) and provide:
  - Aggregated KPIs and dashboards
  - Aging analysis
  - Cash position calculations
  - Payment scheduling & approval summaries
  - Collection worklists
  - Liquidity gap analysis
  - FX exposure & VaR
  - Debt maturity profiles & amortization
  - Bank reconciliation matching
  - Project finance P&L & milestone tracking
"""

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from decimal import Decimal

from starlette.requests import Request
from starlette.responses import JSONResponse

from agent.tms_engine import _supabase, ENTITY_CONFIG, check_permission, AuthorizationError, _json_serial

logger = logging.getLogger("tms_core_modules")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


def _user_ctx(request: Request) -> dict:
    return {
        "user_id": request.headers.get("x-user-id", "anonymous"),
        "user_name": request.headers.get("x-user-name", ""),
        "user_role": request.headers.get("x-user-role", "viewer"),
    }


def _to_float(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


# ═════════════════════════════════════════════════════════════════════════════
# M1: CASH MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════

async def cash_position(request: Request) -> JSONResponse:
    """GET /tms/cash/position — Real-time cash position across BUs/currencies."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cash", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        empresa = request.query_params.get("empresa")

        # Aggregate from cashflow_forecast (most recent actual entries)
        filters: dict = {"status": "ejecutado"}
        if empresa:
            filters["empresa"] = empresa

        rows = await _supabase.select(
            "tms.cashflow_forecast",
            filters=filters,
            order="semana_inicio.desc",
            limit=500,
        )

        # Build position by empresa
        positions: dict[str, dict] = {}
        for r in rows:
            emp = r.get("empresa", "Sin empresa")
            if emp not in positions:
                positions[emp] = {
                    "empresa": emp,
                    "total_ingresos": 0, "total_egresos": 0,
                    "flujo_neto": 0, "saldo_acumulado": 0,
                    "moneda": r.get("moneda", "USD"),
                    "semanas": 0,
                    "ultima_semana": r.get("semana_inicio"),
                }
            pos = positions[emp]
            pos["total_ingresos"] += _to_float(r.get("ingresos"))
            pos["total_egresos"] += _to_float(r.get("egresos"))
            pos["flujo_neto"] += _to_float(r.get("flujo_neto"))
            pos["semanas"] += 1
            if r.get("saldo_acumulado"):
                pos["saldo_acumulado"] = _to_float(r["saldo_acumulado"])

        result = list(positions.values())
        grand_total = {
            "empresa": "CONSOLIDADO",
            "total_ingresos": sum(p["total_ingresos"] for p in result),
            "total_egresos": sum(p["total_egresos"] for p in result),
            "flujo_neto": sum(p["flujo_neto"] for p in result),
            "saldo_acumulado": sum(p["saldo_acumulado"] for p in result),
            "moneda": "USD",
            "semanas": max((p["semanas"] for p in result), default=0),
        }

        return JSONResponse({
            "positions": result,
            "consolidated": grand_total,
            "count": len(result),
        })
    except Exception as e:
        logger.error(f"cash_position error: {e}")
        return _err(str(e), 500)


async def cash_forecast(request: Request) -> JSONResponse:
    """GET /tms/cash/forecast — Weekly forecast with actuals overlay."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cash", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        empresa = request.query_params.get("empresa")
        weeks = int(request.query_params.get("weeks", "12"))
        scenario_id = request.query_params.get("scenario_id")

        filters: dict = {}
        if empresa:
            filters["empresa"] = empresa
        if scenario_id:
            filters["scenario_id"] = scenario_id

        rows = await _supabase.select(
            "tms.cashflow_forecast",
            filters=filters,
            order="semana_inicio.asc",
            limit=weeks * 5,  # up to 5 empresas
        )

        # Group by week
        weekly: dict[str, dict] = {}
        for r in rows:
            week = r.get("semana_inicio", "")
            if not week:
                continue
            if week not in weekly:
                weekly[week] = {
                    "semana": week,
                    "ingresos_ejecutado": 0, "egresos_ejecutado": 0,
                    "ingresos_proyectado": 0, "egresos_proyectado": 0,
                    "flujo_neto": 0, "saldo_acumulado": 0,
                }
            w = weekly[week]
            status = r.get("status", "proyectado")
            ing = _to_float(r.get("ingresos"))
            egr = _to_float(r.get("egresos"))
            if status == "ejecutado":
                w["ingresos_ejecutado"] += ing
                w["egresos_ejecutado"] += egr
            else:
                w["ingresos_proyectado"] += ing
                w["egresos_proyectado"] += egr
            w["flujo_neto"] += _to_float(r.get("flujo_neto"))
            if r.get("saldo_acumulado"):
                w["saldo_acumulado"] = _to_float(r["saldo_acumulado"])

        result = sorted(weekly.values(), key=lambda x: x["semana"])[:weeks]

        return JSONResponse({"forecast": result, "weeks": len(result)})
    except Exception as e:
        logger.error(f"cash_forecast error: {e}")
        return _err(str(e), 500)


async def cash_liquidity_gap(request: Request) -> JSONResponse:
    """GET /tms/cash/liquidity-gap — Maturity ladder: inflows vs outflows by bucket."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cash", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        today = datetime.now(timezone.utc).date()
        buckets_def = [
            ("1d", 1), ("1w", 7), ("2w", 14), ("1m", 30),
            ("3m", 90), ("6m", 180), ("12m", 365),
        ]

        # Get payment instructions as outflows
        payments = await _supabase.select(
            "tms.payment_instructions",
            filters={"estado": f"neq.pagado"},
            limit=1000,
        )

        # Get cashflow_forecast entries as inflows/outflows
        forecasts = await _supabase.select(
            "tms.cashflow_forecast",
            filters={"status": "proyectado"},
            order="semana_inicio.asc",
            limit=500,
        )

        # Build buckets
        buckets = []
        prev_days = 0
        for label, max_days in buckets_def:
            bucket = {
                "bucket": label, "max_days": max_days,
                "inflows": 0, "outflows": 0, "gap": 0,
            }

            for f in forecasts:
                week = f.get("semana_inicio", "")
                if not week:
                    continue
                try:
                    diff = (datetime.fromisoformat(week).date() - today).days
                except (ValueError, TypeError):
                    continue
                if prev_days <= diff < max_days:
                    bucket["inflows"] += _to_float(f.get("ingresos"))
                    bucket["outflows"] += _to_float(f.get("egresos"))

            for p in payments:
                # Use batch fecha_pago or created_at as proxy
                fecha = p.get("created_at", "")
                if not fecha:
                    continue
                try:
                    diff = (datetime.fromisoformat(fecha.replace("Z", "+00:00")).date() - today).days
                except (ValueError, TypeError):
                    continue
                if prev_days <= diff < max_days:
                    bucket["outflows"] += _to_float(p.get("monto"))

            bucket["gap"] = bucket["inflows"] - bucket["outflows"]
            buckets.append(bucket)
            prev_days = max_days

        cumulative = 0
        for b in buckets:
            cumulative += b["gap"]
            b["cumulative_gap"] = cumulative

        return JSONResponse({"buckets": buckets})
    except Exception as e:
        logger.error(f"cash_liquidity_gap error: {e}")
        return _err(str(e), 500)


async def cash_scenarios(request: Request) -> JSONResponse:
    """GET /tms/cash/scenarios — List what-if scenarios."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cash", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        rows = await _supabase.select(
            "tms.cashflow_scenarios",
            order="created_at.desc",
            limit=50,
        )
        return JSONResponse({"scenarios": rows, "count": len(rows)})
    except Exception as e:
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M2: CXP — PAYMENTS / ACCOUNTS PAYABLE
# ═════════════════════════════════════════════════════════════════════════════

async def cxp_dashboard(request: Request) -> JSONResponse:
    """GET /tms/cxp/dashboard — KPIs, aging, priority breakdown for payables."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cxp", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        empresa = request.query_params.get("empresa")

        # Get payment instructions (the AP ledger)
        filters: dict = {}
        if empresa:
            filters["empresa"] = empresa

        instructions = await _supabase.select(
            "tms.payment_instructions",
            filters=filters,
            order="created_at.desc",
            limit=2000,
        )

        # Get payment batches
        batches = await _supabase.select(
            "tms.payment_batches",
            filters={"deleted_at": "is.null"} if not empresa else {"deleted_at": "is.null", "empresa": empresa},
            order="fecha_pago.desc",
            limit=100,
        )

        today = datetime.now(timezone.utc).date()

        # KPIs
        total_pendiente = 0
        total_pagado = 0
        total_items = len(instructions)
        by_priority: dict[str, float] = {}
        by_estado: dict[str, int] = {}
        by_metodo: dict[str, float] = {}
        by_proveedor: dict[str, float] = {}

        aging_buckets = {"corriente": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0}
        aging_counts = {"corriente": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0}

        for instr in instructions:
            monto = _to_float(instr.get("monto"))
            estado = instr.get("estado", "pendiente")
            prio = instr.get("prioridad", "normal")
            metodo = instr.get("metodo_pago", "otro")
            prov = instr.get("nombre_beneficiario", "Desconocido")

            by_estado[estado] = by_estado.get(estado, 0) + 1
            by_priority[prio] = by_priority.get(prio, 0) + monto
            by_metodo[metodo] = by_metodo.get(metodo, 0) + monto

            if len(by_proveedor) < 15 or prov in by_proveedor:
                by_proveedor[prov] = by_proveedor.get(prov, 0) + monto

            if estado == "pagado":
                total_pagado += monto
            else:
                total_pendiente += monto

            # Aging from created_at
            created = instr.get("created_at", "")
            if created:
                try:
                    created_date = datetime.fromisoformat(created.replace("Z", "+00:00")).date()
                    days = (today - created_date).days
                    if days <= 0:
                        aging_buckets["corriente"] += monto
                        aging_counts["corriente"] += 1
                    elif days <= 30:
                        aging_buckets["1-30"] += monto
                        aging_counts["1-30"] += 1
                    elif days <= 60:
                        aging_buckets["31-60"] += monto
                        aging_counts["31-60"] += 1
                    elif days <= 90:
                        aging_buckets["61-90"] += monto
                        aging_counts["61-90"] += 1
                    else:
                        aging_buckets["91+"] += monto
                        aging_counts["91+"] += 1
                except (ValueError, TypeError):
                    pass

        # Batch summary
        pending_batches = [b for b in batches if b.get("estado") in ("borrador", "pendiente_aprobacion")]
        approved_batches = [b for b in batches if b.get("estado") == "aprobado"]

        # Top proveedores sorted by amount
        top_proveedores = sorted(
            [{"nombre": k, "monto": v} for k, v in by_proveedor.items()],
            key=lambda x: x["monto"], reverse=True,
        )[:10]

        return JSONResponse({
            "kpis": {
                "total_pendiente": total_pendiente,
                "total_pagado": total_pagado,
                "total_items": total_items,
                "pending_batch_count": len(pending_batches),
                "pending_batch_amount": sum(_to_float(b.get("total_monto")) for b in pending_batches),
                "approved_batch_count": len(approved_batches),
            },
            "aging": [
                {"bucket": k, "monto": v, "count": aging_counts[k]}
                for k, v in aging_buckets.items()
            ],
            "by_priority": [{"priority": k, "monto": v} for k, v in sorted(by_priority.items())],
            "by_estado": [{"estado": k, "count": v} for k, v in by_estado.items()],
            "by_metodo": [{"metodo": k, "monto": v} for k, v in by_metodo.items()],
            "top_proveedores": top_proveedores,
            "pending_batches": pending_batches[:5],
        })
    except Exception as e:
        logger.error(f"cxp_dashboard error: {e}")
        return _err(str(e), 500)


async def cxp_payment_schedule(request: Request) -> JSONResponse:
    """GET /tms/cxp/schedule — Weekly payment schedule by priority."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cxp", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        weeks = int(request.query_params.get("weeks", "4"))
        today = datetime.now(timezone.utc).date()

        batches = await _supabase.select(
            "tms.payment_batches",
            filters={"deleted_at": "is.null"},
            order="fecha_pago.asc",
            limit=100,
        )

        schedule: list[dict] = []
        for w in range(weeks):
            week_start = today + timedelta(days=w * 7)
            week_end = week_start + timedelta(days=6)
            week_batches = [
                b for b in batches
                if b.get("fecha_pago") and week_start.isoformat() <= b["fecha_pago"] <= week_end.isoformat()
            ]
            schedule.append({
                "week": w + 1,
                "start": week_start.isoformat(),
                "end": week_end.isoformat(),
                "batches": len(week_batches),
                "total_monto": sum(_to_float(b.get("total_monto")) for b in week_batches),
                "items": sum(int(b.get("total_items", 0)) for b in week_batches),
                "approved": sum(1 for b in week_batches if b.get("estado") == "aprobado"),
                "pending": sum(1 for b in week_batches if b.get("estado") in ("borrador", "pendiente_aprobacion")),
            })

        return JSONResponse({"schedule": schedule, "weeks": weeks})
    except Exception as e:
        logger.error(f"cxp_payment_schedule error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M3: CXC — COLLECTIONS / ACCOUNTS RECEIVABLE
# ═════════════════════════════════════════════════════════════════════════════

async def cxc_dashboard(request: Request) -> JSONResponse:
    """GET /tms/cxc/dashboard — AR KPIs, aging, collection metrics."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cxc", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        empresa = request.query_params.get("empresa")

        # Pull from silver_finance.cxc_items (existing) + tms.contratos (new)
        # CxC Items — use Supabase PostgREST on silver_finance schema
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept-Profile": "silver_finance",
            }
            params: dict[str, str] = {"select": "*", "limit": "2000", "order": "vencimiento.asc"}
            if empresa:
                params["empresa"] = f"eq.{empresa}"

            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/cxc_items",
                headers=headers,
                params=params,
            )
            cxc_items = resp.json() if resp.status_code == 200 else []

        today = datetime.now(timezone.utc).date()

        # KPIs
        total_pendiente = 0
        total_cobrado = 0
        total_items = len(cxc_items)
        by_area: dict[str, dict] = {}
        by_gestor: dict[str, dict] = {}
        by_estado: dict[str, int] = {}
        by_cliente: dict[str, float] = {}

        aging = {"corriente": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91-120": 0, "121-180": 0, "180+": 0}
        aging_counts = {"corriente": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91-120": 0, "121-180": 0, "180+": 0}

        dso_sum = 0
        dso_count = 0

        for item in cxc_items:
            monto = _to_float(item.get("monto"))
            estado = item.get("estado", "Pendiente")
            area = item.get("area_comercial", "Sin área")
            gestor = item.get("gestor_cobro", "Sin gestor")
            cliente = item.get("cliente", "Desconocido")
            dias_mora = int(item.get("dias_mora", 0) or 0)

            by_estado[estado] = by_estado.get(estado, 0) + 1

            if estado in ("Pagada", "cobrado"):
                total_cobrado += monto
            else:
                total_pendiente += monto

            # By area
            if area not in by_area:
                by_area[area] = {"area": area, "pendiente": 0, "cobrado": 0, "count": 0}
            by_area[area]["count"] += 1
            if estado in ("Pagada", "cobrado"):
                by_area[area]["cobrado"] += monto
            else:
                by_area[area]["pendiente"] += monto

            # By gestor
            if gestor not in by_gestor:
                by_gestor[gestor] = {"gestor": gestor, "pendiente": 0, "count": 0, "dias_mora_avg": 0, "dias_sum": 0}
            by_gestor[gestor]["count"] += 1
            by_gestor[gestor]["pendiente"] += monto if estado not in ("Pagada", "cobrado") else 0
            by_gestor[gestor]["dias_sum"] += dias_mora

            # By cliente (top)
            if len(by_cliente) < 20 or cliente in by_cliente:
                by_cliente[cliente] = by_cliente.get(cliente, 0) + monto

            # Aging
            if dias_mora <= 0:
                aging["corriente"] += monto; aging_counts["corriente"] += 1
            elif dias_mora <= 30:
                aging["1-30"] += monto; aging_counts["1-30"] += 1
            elif dias_mora <= 60:
                aging["31-60"] += monto; aging_counts["31-60"] += 1
            elif dias_mora <= 90:
                aging["61-90"] += monto; aging_counts["61-90"] += 1
            elif dias_mora <= 120:
                aging["91-120"] += monto; aging_counts["91-120"] += 1
            elif dias_mora <= 180:
                aging["121-180"] += monto; aging_counts["121-180"] += 1
            else:
                aging["180+"] += monto; aging_counts["180+"] += 1

            # DSO
            if dias_mora > 0:
                dso_sum += dias_mora
                dso_count += 1

        # Calculate gestor averages
        gestor_list = list(by_gestor.values())
        for g in gestor_list:
            g["dias_mora_avg"] = round(g["dias_sum"] / g["count"], 1) if g["count"] > 0 else 0
            del g["dias_sum"]

        top_clientes = sorted(
            [{"cliente": k, "monto": v} for k, v in by_cliente.items()],
            key=lambda x: x["monto"], reverse=True,
        )[:10]

        dso = round(dso_sum / dso_count, 1) if dso_count > 0 else 0
        collection_rate = round(total_cobrado / (total_cobrado + total_pendiente) * 100, 1) if (total_cobrado + total_pendiente) > 0 else 0

        return JSONResponse({
            "kpis": {
                "total_pendiente": total_pendiente,
                "total_cobrado": total_cobrado,
                "total_items": total_items,
                "dso": dso,
                "collection_rate": collection_rate,
            },
            "aging": [{"bucket": k, "monto": v, "count": aging_counts[k]} for k, v in aging.items()],
            "by_area": list(by_area.values()),
            "by_gestor": sorted(gestor_list, key=lambda x: x["pendiente"], reverse=True),
            "by_estado": [{"estado": k, "count": v} for k, v in by_estado.items()],
            "top_clientes": top_clientes,
        })
    except Exception as e:
        logger.error(f"cxc_dashboard error: {e}")
        return _err(str(e), 500)


async def cxc_collection_worklist(request: Request) -> JSONResponse:
    """GET /tms/cxc/worklist — Prioritized collection queue per gestor."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cxc", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        gestor = request.query_params.get("gestor")
        area = request.query_params.get("area")
        limit = int(request.query_params.get("limit", "50"))

        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept-Profile": "silver_finance",
            }
            params: dict[str, str] = {
                "select": "*",
                "limit": str(limit),
                "order": "dias_mora.desc",
                "estado": "neq.Pagada",
            }
            if gestor:
                params["gestor_cobro"] = f"eq.{gestor}"
            if area:
                params["area_comercial"] = f"eq.{area}"

            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/cxc_items",
                headers=headers,
                params=params,
            )
            items = resp.json() if resp.status_code == 200 else []

        # Add computed priority score: amount * days overdue
        for item in items:
            monto = _to_float(item.get("monto"))
            dias = int(item.get("dias_mora", 0) or 0)
            item["priority_score"] = round(monto * max(1, dias / 30), 2)

        items.sort(key=lambda x: x.get("priority_score", 0), reverse=True)

        return JSONResponse({"worklist": items, "count": len(items)})
    except Exception as e:
        logger.error(f"cxc_worklist error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M6: INVOICING
# ═════════════════════════════════════════════════════════════════════════════

async def invoicing_dashboard(request: Request) -> JSONResponse:
    """GET /tms/invoicing/dashboard — Invoice KPIs, monthly trends, status breakdown."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "invoicing", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Get contratos for project-based invoicing summary
        contratos = await _supabase.select(
            "tms.contratos",
            filters={"deleted_at": "is.null"},
            order="created_at.desc",
            limit=500,
        )

        hitos = await _supabase.select(
            "tms.hitos_contrato",
            filters={"deleted_at": "is.null"},
            order="fecha_programada.asc",
            limit=2000,
        )

        total_contratado = sum(_to_float(c.get("monto_contrato")) for c in contratos)
        total_facturado = sum(_to_float(c.get("monto_facturado")) for c in contratos)
        total_cobrado = sum(_to_float(c.get("monto_cobrado")) for c in contratos)
        total_pendiente = total_contratado - total_facturado

        # Hitos breakdown
        hitos_by_estado: dict[str, int] = {}
        hitos_monto_by_estado: dict[str, float] = {}
        for h in hitos:
            est = h.get("estado", "pendiente")
            hitos_by_estado[est] = hitos_by_estado.get(est, 0) + 1
            hitos_monto_by_estado[est] = hitos_monto_by_estado.get(est, 0) + _to_float(h.get("monto"))

        # Contratos by estado
        contratos_by_estado: dict[str, int] = {}
        for c in contratos:
            est = c.get("estado", "propuesta")
            contratos_by_estado[est] = contratos_by_estado.get(est, 0) + 1

        # By empresa
        by_empresa: dict[str, dict] = {}
        for c in contratos:
            emp = c.get("empresa", "Sin empresa")
            if emp not in by_empresa:
                by_empresa[emp] = {"empresa": emp, "contratado": 0, "facturado": 0, "cobrado": 0, "contratos": 0}
            by_empresa[emp]["contratado"] += _to_float(c.get("monto_contrato"))
            by_empresa[emp]["facturado"] += _to_float(c.get("monto_facturado"))
            by_empresa[emp]["cobrado"] += _to_float(c.get("monto_cobrado"))
            by_empresa[emp]["contratos"] += 1

        # Upcoming hitos (next 30 days)
        today = datetime.now(timezone.utc).date()
        upcoming_hitos = []
        for h in hitos:
            fecha = h.get("fecha_programada")
            if not fecha or h.get("estado") in ("facturado", "cobrado", "cerrado"):
                continue
            try:
                diff = (datetime.fromisoformat(fecha).date() - today).days
                if 0 <= diff <= 30:
                    h["days_until"] = diff
                    upcoming_hitos.append(h)
            except (ValueError, TypeError):
                pass

        upcoming_hitos.sort(key=lambda x: x.get("days_until", 999))

        facturacion_ratio = round(total_facturado / total_contratado * 100, 1) if total_contratado > 0 else 0
        cobranza_ratio = round(total_cobrado / total_facturado * 100, 1) if total_facturado > 0 else 0

        return JSONResponse({
            "kpis": {
                "total_contratado": total_contratado,
                "total_facturado": total_facturado,
                "total_cobrado": total_cobrado,
                "total_pendiente": total_pendiente,
                "facturacion_ratio": facturacion_ratio,
                "cobranza_ratio": cobranza_ratio,
                "contratos_activos": sum(1 for c in contratos if c.get("estado") in ("firmado", "en_ejecucion")),
                "hitos_pendientes": sum(1 for h in hitos if h.get("estado") in ("pendiente",)),
            },
            "contratos_by_estado": [{"estado": k, "count": v} for k, v in contratos_by_estado.items()],
            "hitos_by_estado": [{"estado": k, "count": v, "monto": hitos_monto_by_estado.get(k, 0)} for k, v in hitos_by_estado.items()],
            "by_empresa": list(by_empresa.values()),
            "upcoming_hitos": upcoming_hitos[:10],
        })
    except Exception as e:
        logger.error(f"invoicing_dashboard error: {e}")
        return _err(str(e), 500)


async def invoicing_contract_detail(request: Request) -> JSONResponse:
    """GET /tms/invoicing/contract/{id} — Full contract with milestones."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "invoicing", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        contract_id = request.path_params.get("id")
        if not contract_id:
            return _err("Missing contract id")

        contrato = await _supabase.select_one("tms.contratos", contract_id)
        if not contrato:
            return _err("Contract not found", 404)

        hitos = await _supabase.select(
            "tms.hitos_contrato",
            filters={"contrato_id": contract_id, "deleted_at": "is.null"},
            order="numero_hito.asc",
            limit=100,
        )

        return JSONResponse({"contrato": contrato, "hitos": hitos})
    except Exception as e:
        logger.error(f"invoicing_contract_detail error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M5: PROJECT FINANCE
# ═════════════════════════════════════════════════════════════════════════════

async def project_finance_dashboard(request: Request) -> JSONResponse:
    """GET /tms/projects/dashboard — Portfolio KPIs, lifecycle, P&L by area."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "projects", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        empresa = request.query_params.get("empresa")
        filters: dict = {"deleted_at": "is.null"}
        if empresa:
            filters["empresa"] = empresa

        contratos = await _supabase.select(
            "tms.contratos", filters=filters, order="created_at.desc", limit=1000,
        )
        hitos = await _supabase.select(
            "tms.hitos_contrato", filters={"deleted_at": "is.null"}, order="fecha_programada.asc", limit=5000,
        )

        today = datetime.now(timezone.utc).date()

        # KPIs
        total_contratado = sum(_to_float(c.get("monto_contrato")) for c in contratos)
        total_facturado = sum(_to_float(c.get("monto_facturado")) for c in contratos)
        total_cobrado = sum(_to_float(c.get("monto_cobrado")) for c in contratos)
        total_pendiente = total_contratado - total_facturado
        total_saldo = total_contratado - total_cobrado
        activos = [c for c in contratos if c.get("estado") in ("firmado", "en_ejecucion")]

        facturacion_ratio = round(total_facturado / total_contratado * 100, 1) if total_contratado > 0 else 0
        cobranza_ratio = round(total_cobrado / total_facturado * 100, 1) if total_facturado > 0 else 0

        # Lifecycle breakdown
        lifecycle: dict[str, int] = {}
        for c in contratos:
            est = c.get("estado", "propuesta")
            lifecycle[est] = lifecycle.get(est, 0) + 1

        # By area comercial
        by_area: dict[str, dict] = {}
        for c in contratos:
            area = c.get("area_comercial", "Sin área")
            if area not in by_area:
                by_area[area] = {"area": area, "contratado": 0, "facturado": 0, "cobrado": 0, "count": 0, "margin_pct": 0}
            by_area[area]["contratado"] += _to_float(c.get("monto_contrato"))
            by_area[area]["facturado"] += _to_float(c.get("monto_facturado"))
            by_area[area]["cobrado"] += _to_float(c.get("monto_cobrado"))
            by_area[area]["count"] += 1
        for a in by_area.values():
            a["margin_pct"] = round((a["cobrado"] / a["contratado"]) * 100, 1) if a["contratado"] > 0 else 0

        # By empresa
        by_empresa: dict[str, dict] = {}
        for c in contratos:
            emp = c.get("empresa", "Sin empresa")
            if emp not in by_empresa:
                by_empresa[emp] = {"empresa": emp, "contratado": 0, "facturado": 0, "cobrado": 0, "count": 0}
            by_empresa[emp]["contratado"] += _to_float(c.get("monto_contrato"))
            by_empresa[emp]["facturado"] += _to_float(c.get("monto_facturado"))
            by_empresa[emp]["cobrado"] += _to_float(c.get("monto_cobrado"))
            by_empresa[emp]["count"] += 1

        # By project type
        by_tipo: dict[str, dict] = {}
        for c in contratos:
            tipo = c.get("tipo_proyecto", "Sin tipo")
            if tipo not in by_tipo:
                by_tipo[tipo] = {"tipo": tipo, "contratado": 0, "count": 0}
            by_tipo[tipo]["contratado"] += _to_float(c.get("monto_contrato"))
            by_tipo[tipo]["count"] += 1

        # Milestone alerts (7d / 14d / 30d)
        milestone_alerts = []
        for h in hitos:
            fecha = h.get("fecha_programada")
            if not fecha or h.get("estado") in ("facturado", "cobrado", "cerrado"):
                continue
            try:
                diff = (datetime.fromisoformat(fecha).date() - today).days
                if 0 <= diff <= 30:
                    severity = "critical" if diff <= 7 else "warning" if diff <= 14 else "info"
                    milestone_alerts.append({
                        "hito_id": h.get("id"),
                        "contrato_id": h.get("contrato_id"),
                        "nombre": h.get("nombre", ""),
                        "monto": _to_float(h.get("monto")),
                        "fecha_programada": fecha,
                        "days_until": diff,
                        "severity": severity,
                        "estado": h.get("estado", "pendiente"),
                    })
            except (ValueError, TypeError):
                pass
        milestone_alerts.sort(key=lambda x: x["days_until"])

        # Collection forecast — next 12 weeks from pending hitos
        collection_forecast: list[dict] = []
        for w in range(12):
            week_start = today + timedelta(days=w * 7)
            week_end = week_start + timedelta(days=6)
            week_monto = 0
            week_count = 0
            for h in hitos:
                fecha = h.get("fecha_programada")
                if not fecha or h.get("estado") not in ("pendiente",):
                    continue
                try:
                    fd = datetime.fromisoformat(fecha).date()
                    if week_start <= fd <= week_end:
                        week_monto += _to_float(h.get("monto"))
                        week_count += 1
                except (ValueError, TypeError):
                    pass
            collection_forecast.append({
                "week": w + 1,
                "start": week_start.isoformat(),
                "end": week_end.isoformat(),
                "monto": week_monto,
                "hitos": week_count,
            })

        return JSONResponse({
            "kpis": {
                "total_contratado": total_contratado,
                "total_facturado": total_facturado,
                "total_cobrado": total_cobrado,
                "total_pendiente": total_pendiente,
                "total_saldo": total_saldo,
                "contratos_activos": len(activos),
                "contratos_total": len(contratos),
                "facturacion_ratio": facturacion_ratio,
                "cobranza_ratio": cobranza_ratio,
                "hitos_total": len(hitos),
                "hitos_pendientes": sum(1 for h in hitos if h.get("estado") == "pendiente"),
                "milestone_alerts_count": len(milestone_alerts),
            },
            "lifecycle": [{"estado": k, "count": v} for k, v in lifecycle.items()],
            "by_area": sorted(by_area.values(), key=lambda x: x["contratado"], reverse=True),
            "by_empresa": list(by_empresa.values()),
            "by_tipo": sorted(by_tipo.values(), key=lambda x: x["contratado"], reverse=True),
            "milestone_alerts": milestone_alerts[:20],
            "collection_forecast": collection_forecast,
        })
    except Exception as e:
        logger.error(f"project_finance_dashboard error: {e}")
        return _err(str(e), 500)


async def project_budget_vs_actual(request: Request) -> JSONResponse:
    """GET /tms/projects/budget-vs-actual — Variance analysis per contract."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "projects", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        contratos = await _supabase.select(
            "tms.contratos",
            filters={"deleted_at": "is.null", "estado": "in.(firmado,en_ejecucion)"},
            order="monto_contrato.desc",
            limit=200,
        )

        result = []
        for c in contratos:
            contratado = _to_float(c.get("monto_contrato"))
            facturado = _to_float(c.get("monto_facturado"))
            cobrado = _to_float(c.get("monto_cobrado"))
            variance_factura = facturado - contratado
            variance_cobro = cobrado - facturado
            result.append({
                "id": c.get("id"),
                "numero_contrato": c.get("numero_contrato"),
                "nombre": c.get("nombre"),
                "empresa": c.get("empresa"),
                "area_comercial": c.get("area_comercial"),
                "contratado": contratado,
                "facturado": facturado,
                "cobrado": cobrado,
                "pendiente": contratado - facturado,
                "saldo": contratado - cobrado,
                "variance_factura": variance_factura,
                "variance_cobro": variance_cobro,
                "facturacion_pct": round(facturado / contratado * 100, 1) if contratado > 0 else 0,
                "cobranza_pct": round(cobrado / facturado * 100, 1) if facturado > 0 else 0,
            })

        return JSONResponse({"contracts": result, "count": len(result)})
    except Exception as e:
        logger.error(f"project_budget_vs_actual error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M4: FX & RISK MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════

async def fx_dashboard(request: Request) -> JSONResponse:
    """GET /tms/fx/dashboard — FX exposure, rates, P&L, position summary."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "fx", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # FX positions
        positions = await _supabase.select(
            "tms.fx_positions", order="fecha.desc", limit=500,
        )

        # FX rates (tipos_cambio)
        rates = await _supabase.select(
            "tms.tipos_cambio", order="fecha.desc", limit=365,
        )

        # Hedges
        hedges = await _supabase.select(
            "tms.fx_hedges", order="fecha_vencimiento.asc", limit=100,
        )

        today = datetime.now(timezone.utc).date()

        # Net exposure from positions
        net_usd_receivables = 0
        net_usd_payables = 0
        net_usd_debt = 0
        by_bu: dict[str, dict] = {}

        for p in positions:
            moneda = (p.get("moneda") or "USD").upper()
            if moneda != "USD":
                continue
            tipo = p.get("tipo", "otro")
            monto = _to_float(p.get("monto"))
            empresa = p.get("empresa", "Sin empresa")

            if tipo in ("receivable", "cxc"):
                net_usd_receivables += monto
            elif tipo in ("payable", "cxp"):
                net_usd_payables += monto
            elif tipo in ("debt", "deuda"):
                net_usd_debt += monto

            if empresa not in by_bu:
                by_bu[empresa] = {"empresa": empresa, "receivables": 0, "payables": 0, "debt": 0, "net": 0}
            if tipo in ("receivable", "cxc"):
                by_bu[empresa]["receivables"] += monto
            elif tipo in ("payable", "cxp"):
                by_bu[empresa]["payables"] += monto
            elif tipo in ("debt", "deuda"):
                by_bu[empresa]["debt"] += monto

        for b in by_bu.values():
            b["net"] = b["receivables"] - b["payables"] - b["debt"]

        net_exposure = net_usd_receivables - net_usd_payables - net_usd_debt

        # Latest rate
        latest_rate = rates[0] if rates else {}
        rate_compra = _to_float(latest_rate.get("compra"))
        rate_venta = _to_float(latest_rate.get("venta"))
        rate_fecha = latest_rate.get("fecha", "")

        # Rate trend (last 30 entries)
        rate_trend = []
        for r in rates[:90]:
            rate_trend.append({
                "fecha": r.get("fecha", ""),
                "compra": _to_float(r.get("compra")),
                "venta": _to_float(r.get("venta")),
                "promedio": (_to_float(r.get("compra")) + _to_float(r.get("venta"))) / 2,
            })
        rate_trend.reverse()

        # Hedges summary
        active_hedges = [h for h in hedges if h.get("estado") in ("activo", "vigente")]
        total_hedged = sum(_to_float(h.get("monto_nocional")) for h in active_hedges)
        hedge_ratio = round(total_hedged / abs(net_exposure) * 100, 1) if net_exposure != 0 else 0

        # Parametric VaR (95%, 1-day) — simplified
        if len(rate_trend) >= 10:
            returns = []
            for i in range(1, len(rate_trend)):
                prev = rate_trend[i - 1]["promedio"]
                curr = rate_trend[i]["promedio"]
                if prev > 0:
                    returns.append((curr - prev) / prev)
            if returns:
                import statistics
                vol = statistics.stdev(returns) if len(returns) > 1 else 0
                var_95 = abs(net_exposure) * vol * 1.65  # 95% confidence
            else:
                var_95 = 0
        else:
            var_95 = 0

        # FX gain/loss estimation
        fx_gain_loss = 0
        if rate_compra > 0 and len(rate_trend) >= 2:
            prev_rate = rate_trend[-2]["promedio"] if len(rate_trend) >= 2 else rate_compra
            curr_rate = rate_trend[-1]["promedio"]
            fx_gain_loss = net_exposure * (curr_rate - prev_rate)

        return JSONResponse({
            "kpis": {
                "net_exposure_usd": net_exposure,
                "usd_receivables": net_usd_receivables,
                "usd_payables": net_usd_payables,
                "usd_debt": net_usd_debt,
                "rate_compra": rate_compra,
                "rate_venta": rate_venta,
                "rate_fecha": rate_fecha,
                "total_hedged": total_hedged,
                "hedge_ratio": hedge_ratio,
                "var_95_1d": round(var_95, 2),
                "fx_gain_loss": round(fx_gain_loss, 2),
                "active_hedges_count": len(active_hedges),
            },
            "by_bu": sorted(by_bu.values(), key=lambda x: abs(x["net"]), reverse=True),
            "rate_trend": rate_trend[-90:],
            "hedges": [{
                "id": h.get("id"),
                "tipo": h.get("tipo_instrumento", "forward"),
                "monto_nocional": _to_float(h.get("monto_nocional")),
                "tasa_pactada": _to_float(h.get("tasa_pactada")),
                "fecha_vencimiento": h.get("fecha_vencimiento"),
                "estado": h.get("estado"),
                "contraparte": h.get("contraparte", ""),
            } for h in active_hedges[:20]],
        })
    except Exception as e:
        logger.error(f"fx_dashboard error: {e}")
        return _err(str(e), 500)


async def fx_scenario_sim(request: Request) -> JSONResponse:
    """GET /tms/fx/scenarios — What-if on FX rate movements."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "fx", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Get current exposure
        positions = await _supabase.select("tms.fx_positions", limit=500)
        rates = await _supabase.select("tms.tipos_cambio", order="fecha.desc", limit=1)

        net_exposure = 0
        for p in positions:
            if (p.get("moneda") or "").upper() != "USD":
                continue
            monto = _to_float(p.get("monto"))
            tipo = p.get("tipo", "")
            if tipo in ("receivable", "cxc"):
                net_exposure += monto
            elif tipo in ("payable", "cxp", "debt", "deuda"):
                net_exposure -= monto

        base_rate = _to_float(rates[0].get("venta")) if rates else 530.0

        # Generate scenarios
        shocks = [-10, -5, -2, -1, 0, 1, 2, 5, 10, 15, 20]
        scenarios = []
        for pct in shocks:
            new_rate = base_rate * (1 + pct / 100)
            impact_crc = net_exposure * (new_rate - base_rate)
            scenarios.append({
                "shock_pct": pct,
                "new_rate": round(new_rate, 2),
                "impact_crc": round(impact_crc, 2),
                "impact_usd": round(impact_crc / new_rate, 2) if new_rate > 0 else 0,
                "label": f"{'+' if pct > 0 else ''}{pct}%",
            })

        return JSONResponse({
            "base_rate": base_rate,
            "net_exposure": net_exposure,
            "scenarios": scenarios,
        })
    except Exception as e:
        logger.error(f"fx_scenario_sim error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M8: DEBT & OPERATIONS MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════

async def debt_dashboard(request: Request) -> JSONResponse:
    """GET /tms/debt/dashboard — Loan portfolio KPIs, maturity profile, schedules."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "debt", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        instruments = await _supabase.select(
            "tms.debt_instruments", order="fecha_vencimiento.asc", limit=200,
        )
        schedules = await _supabase.select(
            "tms.debt_schedules", order="fecha_pago.asc", limit=2000,
        )

        today = datetime.now(timezone.utc).date()

        # KPIs
        total_saldo_original = 0
        total_capital_vigente = 0
        total_intereses_acumulados = 0
        by_tipo: dict[str, dict] = {}
        by_banco: dict[str, dict] = {}
        by_moneda: dict[str, float] = {}
        active_count = 0

        for inst in instruments:
            saldo_orig = _to_float(inst.get("saldo_original"))
            capital_vig = _to_float(inst.get("capital_vigente", saldo_orig))
            intereses = _to_float(inst.get("intereses_acumulados"))
            total_saldo_original += saldo_orig
            total_capital_vigente += capital_vig
            total_intereses_acumulados += intereses

            estado = inst.get("estado", "vigente")
            if estado in ("vigente", "activo"):
                active_count += 1

            tipo = inst.get("tipo", "otro")
            if tipo not in by_tipo:
                by_tipo[tipo] = {"tipo": tipo, "capital": 0, "count": 0}
            by_tipo[tipo]["capital"] += capital_vig
            by_tipo[tipo]["count"] += 1

            banco = inst.get("banco", "Sin banco")
            if banco not in by_banco:
                by_banco[banco] = {"banco": banco, "capital": 0, "count": 0}
            by_banco[banco]["capital"] += capital_vig
            by_banco[banco]["count"] += 1

            moneda = inst.get("moneda", "USD")
            by_moneda[moneda] = by_moneda.get(moneda, 0) + capital_vig

        # Maturity profile (buckets)
        maturity_buckets = {"0-3m": 0, "3-6m": 0, "6-12m": 0, "1-3y": 0, "3-5y": 0, "5y+": 0}
        for inst in instruments:
            venc = inst.get("fecha_vencimiento")
            capital = _to_float(inst.get("capital_vigente", inst.get("saldo_original")))
            if not venc:
                continue
            try:
                diff = (datetime.fromisoformat(venc).date() - today).days
                if diff <= 90:
                    maturity_buckets["0-3m"] += capital
                elif diff <= 180:
                    maturity_buckets["3-6m"] += capital
                elif diff <= 365:
                    maturity_buckets["6-12m"] += capital
                elif diff <= 1095:
                    maturity_buckets["1-3y"] += capital
                elif diff <= 1825:
                    maturity_buckets["3-5y"] += capital
                else:
                    maturity_buckets["5y+"] += capital
            except (ValueError, TypeError):
                pass

        # Upcoming payments (next 12 weeks)
        payment_schedule: list[dict] = []
        for w in range(12):
            week_start = today + timedelta(days=w * 7)
            week_end = week_start + timedelta(days=6)
            week_principal = 0
            week_interes = 0
            week_count = 0
            for s in schedules:
                fecha = s.get("fecha_pago")
                if not fecha:
                    continue
                try:
                    fd = datetime.fromisoformat(fecha).date()
                    if week_start <= fd <= week_end:
                        week_principal += _to_float(s.get("principal"))
                        week_interes += _to_float(s.get("intereses"))
                        week_count += 1
                except (ValueError, TypeError):
                    pass
            payment_schedule.append({
                "week": w + 1,
                "start": week_start.isoformat(),
                "end": week_end.isoformat(),
                "principal": week_principal,
                "intereses": week_interes,
                "cuota": week_principal + week_interes,
                "pagos": week_count,
            })

        # Weighted average rate
        weighted_rate_num = 0
        weighted_rate_den = 0
        for inst in instruments:
            cap = _to_float(inst.get("capital_vigente", inst.get("saldo_original")))
            rate = _to_float(inst.get("tasa_interes"))
            if cap > 0 and rate > 0:
                weighted_rate_num += cap * rate
                weighted_rate_den += cap
        avg_rate = round(weighted_rate_num / weighted_rate_den, 4) if weighted_rate_den > 0 else 0

        return JSONResponse({
            "kpis": {
                "total_saldo_original": total_saldo_original,
                "total_capital_vigente": total_capital_vigente,
                "total_intereses_acumulados": total_intereses_acumulados,
                "active_instruments": active_count,
                "total_instruments": len(instruments),
                "weighted_avg_rate": avg_rate,
                "next_payment_amount": payment_schedule[0]["cuota"] if payment_schedule else 0,
            },
            "maturity_profile": [{"bucket": k, "capital": v} for k, v in maturity_buckets.items()],
            "by_tipo": sorted(by_tipo.values(), key=lambda x: x["capital"], reverse=True),
            "by_banco": sorted(by_banco.values(), key=lambda x: x["capital"], reverse=True),
            "by_moneda": [{"moneda": k, "capital": v} for k, v in by_moneda.items()],
            "payment_schedule": payment_schedule,
            "instruments": [{
                "id": i.get("id"),
                "nombre": i.get("nombre"),
                "tipo": i.get("tipo"),
                "banco": i.get("banco"),
                "moneda": i.get("moneda"),
                "saldo_original": _to_float(i.get("saldo_original")),
                "capital_vigente": _to_float(i.get("capital_vigente", i.get("saldo_original"))),
                "tasa_interes": _to_float(i.get("tasa_interes")),
                "fecha_vencimiento": i.get("fecha_vencimiento"),
                "estado": i.get("estado"),
                "empresa": i.get("empresa"),
            } for i in instruments[:50]],
        })
    except Exception as e:
        logger.error(f"debt_dashboard error: {e}")
        return _err(str(e), 500)


async def debt_instrument_detail(request: Request) -> JSONResponse:
    """GET /tms/debt/instrument/{id} — Full instrument with amortization schedule."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "debt", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        instrument_id = request.path_params.get("id")
        if not instrument_id:
            return _err("Missing instrument id")

        instrument = await _supabase.select_one("tms.debt_instruments", instrument_id)
        if not instrument:
            return _err("Instrument not found", 404)

        schedule = await _supabase.select(
            "tms.debt_schedules",
            filters={"instrument_id": instrument_id},
            order="fecha_pago.asc",
            limit=500,
        )

        # Compute running capital balance
        capital = _to_float(instrument.get("saldo_original"))
        for s in schedule:
            principal = _to_float(s.get("principal"))
            capital -= principal
            s["capital_restante"] = round(capital, 2)

        return JSONResponse({"instrument": instrument, "schedule": schedule})
    except Exception as e:
        logger.error(f"debt_instrument_detail error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M7: BANK RECONCILIATION
# ═════════════════════════════════════════════════════════════════════════════

async def recon_dashboard(request: Request) -> JSONResponse:
    """GET /tms/recon/dashboard — Bank reconciliation KPIs, match status, exceptions."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "recon", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        statements = await _supabase.select(
            "tms.bank_statements", order="fecha_estado.desc", limit=100,
        )
        lines = await _supabase.select(
            "tms.bank_statement_lines", order="fecha.desc", limit=2000,
        )
        matches = await _supabase.select(
            "tms.recon_matches", order="created_at.desc", limit=1000,
        )
        bank_movements = await _supabase.select(
            "tms.movimientos_bancarios", order="fecha.desc", limit=1000,
        )

        # KPIs
        total_lines = len(lines)
        matched_line_ids = set()
        for m in matches:
            lid = m.get("statement_line_id")
            if lid:
                matched_line_ids.add(lid)

        matched_count = len(matched_line_ids)
        unmatched_count = total_lines - matched_count
        match_rate = round(matched_count / total_lines * 100, 1) if total_lines > 0 else 0

        total_debits = sum(_to_float(l.get("monto")) for l in lines if _to_float(l.get("monto")) < 0)
        total_credits = sum(_to_float(l.get("monto")) for l in lines if _to_float(l.get("monto")) >= 0)

        # Match types breakdown
        by_match_type: dict[str, int] = {}
        for m in matches:
            mt = m.get("match_type", "manual")
            by_match_type[mt] = by_match_type.get(mt, 0) + 1

        # By bank
        by_banco: dict[str, dict] = {}
        for s in statements:
            banco = s.get("banco", "Sin banco")
            if banco not in by_banco:
                by_banco[banco] = {
                    "banco": banco, "statements": 0,
                    "saldo_banco": 0, "saldo_libros": 0, "diferencia": 0,
                }
            by_banco[banco]["statements"] += 1
            by_banco[banco]["saldo_banco"] += _to_float(s.get("saldo_banco"))
            by_banco[banco]["saldo_libros"] += _to_float(s.get("saldo_libros"))
        for b in by_banco.values():
            b["diferencia"] = b["saldo_banco"] - b["saldo_libros"]

        # Exception queue (unmatched lines, sorted by amount desc)
        exception_queue = []
        for l in lines:
            lid = l.get("id")
            if lid in matched_line_ids:
                continue
            exception_queue.append({
                "id": lid,
                "fecha": l.get("fecha"),
                "descripcion": l.get("descripcion", ""),
                "referencia": l.get("referencia", ""),
                "monto": _to_float(l.get("monto")),
                "banco": l.get("banco", ""),
                "cuenta": l.get("cuenta", ""),
                "tipo": "crédito" if _to_float(l.get("monto")) >= 0 else "débito",
            })
        exception_queue.sort(key=lambda x: abs(x["monto"]), reverse=True)

        # Bank balance monitor
        balances = []
        seen_banks: set[str] = set()
        for s in statements:
            banco = s.get("banco", "")
            cuenta = s.get("cuenta", "")
            key = f"{banco}|{cuenta}"
            if key in seen_banks:
                continue
            seen_banks.add(key)
            balances.append({
                "banco": banco,
                "cuenta": cuenta,
                "moneda": s.get("moneda", "USD"),
                "saldo_banco": _to_float(s.get("saldo_banco")),
                "saldo_libros": _to_float(s.get("saldo_libros")),
                "diferencia": _to_float(s.get("saldo_banco")) - _to_float(s.get("saldo_libros")),
                "fecha_estado": s.get("fecha_estado"),
            })

        return JSONResponse({
            "kpis": {
                "total_statements": len(statements),
                "total_lines": total_lines,
                "matched_count": matched_count,
                "unmatched_count": unmatched_count,
                "match_rate": match_rate,
                "total_credits": total_credits,
                "total_debits": abs(total_debits),
                "bank_movements_count": len(bank_movements),
            },
            "by_match_type": [{"type": k, "count": v} for k, v in by_match_type.items()],
            "by_banco": list(by_banco.values()),
            "exception_queue": exception_queue[:50],
            "balances": balances,
        })
    except Exception as e:
        logger.error(f"recon_dashboard error: {e}")
        return _err(str(e), 500)


async def recon_auto_match(request: Request) -> JSONResponse:
    """POST /tms/recon/auto-match — Trigger automatic matching of unmatched bank lines."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "recon", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Get unmatched statement lines
        lines = await _supabase.select(
            "tms.bank_statement_lines", order="fecha.desc", limit=2000,
        )
        existing_matches = await _supabase.select(
            "tms.recon_matches", limit=5000,
        )
        bank_movements = await _supabase.select(
            "tms.movimientos_bancarios", order="fecha.desc", limit=2000,
        )

        matched_line_ids = {m.get("statement_line_id") for m in existing_matches}
        unmatched = [l for l in lines if l.get("id") not in matched_line_ids]

        new_matches = []
        for line in unmatched:
            line_monto = _to_float(line.get("monto"))
            line_ref = (line.get("referencia") or "").strip().lower()
            line_fecha = line.get("fecha", "")

            best_match = None
            best_score = 0

            for mv in bank_movements:
                mv_monto = _to_float(mv.get("monto"))
                mv_ref = (mv.get("referencia") or "").strip().lower()
                mv_fecha = mv.get("fecha", "")

                score = 0

                # Amount match (exact or within 1%)
                if line_monto != 0 and mv_monto != 0:
                    if abs(line_monto - mv_monto) < 0.01:
                        score += 50
                    elif abs(line_monto - mv_monto) / abs(line_monto) < 0.01:
                        score += 30

                # Reference match
                if line_ref and mv_ref and (line_ref in mv_ref or mv_ref in line_ref):
                    score += 30

                # Date proximity (within 3 days)
                if line_fecha and mv_fecha:
                    try:
                        ld = datetime.fromisoformat(line_fecha.replace("Z", "+00:00")).date()
                        md = datetime.fromisoformat(mv_fecha.replace("Z", "+00:00")).date()
                        day_diff = abs((ld - md).days)
                        if day_diff == 0:
                            score += 20
                        elif day_diff <= 3:
                            score += 10
                    except (ValueError, TypeError):
                        pass

                if score > best_score:
                    best_score = score
                    best_match = mv

            # Only match if confidence >= 60
            if best_match and best_score >= 60:
                new_matches.append({
                    "statement_line_id": line.get("id"),
                    "movement_id": best_match.get("id"),
                    "match_type": "auto",
                    "confidence_score": best_score,
                    "monto_statement": line_monto,
                    "monto_movement": _to_float(best_match.get("monto")),
                    "matched_by": ctx["user_id"],
                })

        # Insert matches
        inserted = 0
        for match_data in new_matches:
            try:
                await _supabase.insert("tms.recon_matches", match_data)
                inserted += 1
            except Exception:
                pass

        return JSONResponse({
            "unmatched_input": len(unmatched),
            "matches_found": len(new_matches),
            "matches_inserted": inserted,
            "match_rate": round(inserted / len(unmatched) * 100, 1) if unmatched else 0,
        })
    except Exception as e:
        logger.error(f"recon_auto_match error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M9: MRP / PROCUREMENT
# ═════════════════════════════════════════════════════════════════════════════

async def mrp_dashboard(request: Request) -> JSONResponse:
    """GET /tms/mrp/dashboard — Inventory KPIs, stockout alerts, ABC summary."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "mrp", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Pull from silver_finance.mrp_master
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            headers_sb = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept-Profile": "silver_finance",
            }
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/mrp_master",
                headers=headers_sb,
                params={"select": "*", "limit": "5000"},
            )
            items = resp.json() if resp.status_code == 200 else []

        total_items = len(items)
        total_value = 0
        stockout_alerts = []
        abc_summary: dict[str, dict] = {"A": {"count": 0, "value": 0}, "B": {"count": 0, "value": 0}, "C": {"count": 0, "value": 0}}
        by_category: dict[str, dict] = {}
        reorder_needed = 0

        for item in items:
            stock = _to_float(item.get("inventario_disponible") or item.get("stock_actual"))
            costo = _to_float(item.get("costo_unitario") or item.get("precio_unitario"))
            consumo = _to_float(item.get("consumo_mensual") or item.get("consumo_diario", 0) * 30)
            lead_time = int(item.get("lead_time_dias") or item.get("lead_time") or 30)
            punto_reorden = _to_float(item.get("punto_reorden") or item.get("reorder_point"))
            abc = (item.get("clasificacion_abc") or item.get("abc_class") or "C").upper()
            categoria = item.get("categoria") or item.get("category") or "Sin categoría"

            value = stock * costo
            total_value += value

            if abc in abc_summary:
                abc_summary[abc]["count"] += 1
                abc_summary[abc]["value"] += value

            if categoria not in by_category:
                by_category[categoria] = {"categoria": categoria, "items": 0, "value": 0, "stockouts": 0}
            by_category[categoria]["items"] += 1
            by_category[categoria]["value"] += value

            # Stockout alert
            dias_cobertura = stock / max(consumo / 30, 0.001) if consumo > 0 else 999
            if dias_cobertura < lead_time or (punto_reorden > 0 and stock < punto_reorden):
                reorder_needed += 1
                by_category[categoria]["stockouts"] += 1
                if len(stockout_alerts) < 30:
                    stockout_alerts.append({
                        "codigo": item.get("codigo") or item.get("sku") or "",
                        "descripcion": item.get("descripcion") or item.get("nombre") or "",
                        "stock": stock,
                        "punto_reorden": punto_reorden,
                        "dias_cobertura": round(dias_cobertura, 1),
                        "lead_time": lead_time,
                        "consumo_mensual": round(consumo, 2),
                        "abc": abc,
                        "categoria": categoria,
                        "urgency": "critical" if dias_cobertura < lead_time * 0.5 else "warning",
                    })

        stockout_alerts.sort(key=lambda x: x["dias_cobertura"])

        return JSONResponse({
            "kpis": {
                "total_items": total_items,
                "total_value": round(total_value, 2),
                "reorder_needed": reorder_needed,
                "stockout_rate": round(reorder_needed / total_items * 100, 1) if total_items > 0 else 0,
                "abc_a_count": abc_summary["A"]["count"],
                "abc_b_count": abc_summary["B"]["count"],
                "abc_c_count": abc_summary["C"]["count"],
            },
            "abc_summary": [{"class": k, "count": v["count"], "value": v["value"]} for k, v in abc_summary.items()],
            "by_category": sorted(by_category.values(), key=lambda x: x["value"], reverse=True)[:20],
            "stockout_alerts": stockout_alerts,
        })
    except Exception as e:
        logger.error(f"mrp_dashboard error: {e}")
        return _err(str(e), 500)


async def mrp_reorder_recommendations(request: Request) -> JSONResponse:
    """GET /tms/mrp/reorder — EOQ-based reorder recommendations."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "mrp", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        import httpx
        import math
        async with httpx.AsyncClient(timeout=15) as client:
            headers_sb = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept-Profile": "silver_finance",
            }
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/mrp_master",
                headers=headers_sb,
                params={"select": "*", "limit": "5000"},
            )
            items = resp.json() if resp.status_code == 200 else []

        recommendations = []
        for item in items:
            stock = _to_float(item.get("inventario_disponible") or item.get("stock_actual"))
            costo = _to_float(item.get("costo_unitario") or item.get("precio_unitario"))
            consumo_m = _to_float(item.get("consumo_mensual") or item.get("consumo_diario", 0) * 30)
            lead_time = int(item.get("lead_time_dias") or item.get("lead_time") or 30)
            punto_reorden = _to_float(item.get("punto_reorden") or item.get("reorder_point"))

            if consumo_m <= 0:
                continue

            consumo_d = consumo_m / 30
            dias_cobertura = stock / max(consumo_d, 0.001)

            if punto_reorden > 0 and stock >= punto_reorden and dias_cobertura >= lead_time:
                continue

            # EOQ = sqrt(2 * D * S / H), assume S=50 (ordering cost), H = 20% of unit cost
            demand_annual = consumo_m * 12
            ordering_cost = 50
            holding_cost = max(costo * 0.20, 0.01)
            eoq = math.sqrt(2 * demand_annual * ordering_cost / holding_cost) if holding_cost > 0 else consumo_m

            # Safety stock (95% SL, Z=1.65)
            safety_stock = 1.65 * (consumo_m * 0.2) * math.sqrt(lead_time / 30)

            recommendations.append({
                "codigo": item.get("codigo") or item.get("sku") or "",
                "descripcion": item.get("descripcion") or item.get("nombre") or "",
                "stock_actual": stock,
                "consumo_mensual": round(consumo_m, 2),
                "lead_time": lead_time,
                "dias_cobertura": round(dias_cobertura, 1),
                "eoq": round(eoq, 0),
                "safety_stock": round(safety_stock, 0),
                "cantidad_sugerida": round(max(eoq, safety_stock + consumo_d * lead_time - stock), 0),
                "costo_estimado": round(max(eoq, safety_stock + consumo_d * lead_time - stock) * costo, 2),
                "abc": (item.get("clasificacion_abc") or item.get("abc_class") or "C").upper(),
                "proveedor": item.get("proveedor") or item.get("supplier") or "",
            })

        recommendations.sort(key=lambda x: x["costo_estimado"], reverse=True)

        return JSONResponse({
            "recommendations": recommendations[:100],
            "total_items": len(recommendations),
            "total_investment": round(sum(r["costo_estimado"] for r in recommendations), 2),
        })
    except Exception as e:
        logger.error(f"mrp_reorder error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M10: BOARD REPORTING
# ═════════════════════════════════════════════════════════════════════════════

async def board_executive_dashboard(request: Request) -> JSONResponse:
    """GET /tms/board/executive — Single-pane executive summary across all modules."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "board", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Fetch key data from multiple modules in parallel-ish fashion
        cashflow = await _supabase.select("tms.cashflow_forecast", filters={"status": "ejecutado"}, order="semana_inicio.desc", limit=200)
        contratos = await _supabase.select("tms.contratos", filters={"deleted_at": "is.null"}, limit=500)
        debt = await _supabase.select("tms.debt_instruments", limit=100)
        batches = await _supabase.select("tms.payment_batches", filters={"deleted_at": "is.null"}, order="fecha_pago.desc", limit=50)
        fx_rates = await _supabase.select("tms.tipos_cambio", order="fecha.desc", limit=5)

        # Cash summary
        total_ingresos = sum(_to_float(r.get("ingresos")) for r in cashflow)
        total_egresos = sum(_to_float(r.get("egresos")) for r in cashflow)
        flujo_neto = total_ingresos - total_egresos

        # Project summary
        total_contratado = sum(_to_float(c.get("monto_contrato")) for c in contratos)
        total_cobrado = sum(_to_float(c.get("monto_cobrado")) for c in contratos)
        contratos_activos = sum(1 for c in contratos if c.get("estado") in ("firmado", "en_ejecucion"))

        # Debt summary
        total_debt = sum(_to_float(d.get("capital_vigente", d.get("saldo_original"))) for d in debt)
        active_loans = sum(1 for d in debt if d.get("estado") in ("vigente", "activo"))

        # CxP summary
        pending_batches = sum(1 for b in batches if b.get("estado") in ("borrador", "pendiente_aprobacion"))
        pending_amount = sum(_to_float(b.get("total_monto")) for b in batches if b.get("estado") in ("borrador", "pendiente_aprobacion"))

        # FX
        latest_rate = fx_rates[0] if fx_rates else {}

        # BU comparison
        by_bu: dict[str, dict] = {}
        for r in cashflow:
            emp = r.get("empresa", "Sin empresa")
            if emp not in by_bu:
                by_bu[emp] = {"empresa": emp, "ingresos": 0, "egresos": 0, "flujo_neto": 0}
            by_bu[emp]["ingresos"] += _to_float(r.get("ingresos"))
            by_bu[emp]["egresos"] += _to_float(r.get("egresos"))
            by_bu[emp]["flujo_neto"] += _to_float(r.get("flujo_neto"))

        return JSONResponse({
            "cash": {
                "total_ingresos": total_ingresos,
                "total_egresos": total_egresos,
                "flujo_neto": flujo_neto,
            },
            "projects": {
                "total_contratado": total_contratado,
                "total_cobrado": total_cobrado,
                "contratos_activos": contratos_activos,
                "total_contratos": len(contratos),
            },
            "debt": {
                "total_capital": total_debt,
                "active_loans": active_loans,
            },
            "cxp": {
                "pending_batches": pending_batches,
                "pending_amount": pending_amount,
            },
            "fx": {
                "rate_compra": _to_float(latest_rate.get("compra")),
                "rate_venta": _to_float(latest_rate.get("venta")),
                "rate_fecha": latest_rate.get("fecha", ""),
            },
            "by_bu": list(by_bu.values()),
        })
    except Exception as e:
        logger.error(f"board_executive error: {e}")
        return _err(str(e), 500)


async def board_bu_comparison(request: Request) -> JSONResponse:
    """GET /tms/board/bu-comparison — Side-by-side BU performance."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "board", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        cashflow = await _supabase.select("tms.cashflow_forecast", limit=1000)
        contratos = await _supabase.select("tms.contratos", filters={"deleted_at": "is.null"}, limit=1000)

        by_bu: dict[str, dict] = {}
        for r in cashflow:
            emp = r.get("empresa", "Sin empresa")
            if emp not in by_bu:
                by_bu[emp] = {
                    "empresa": emp,
                    "ingresos": 0, "egresos": 0, "flujo_neto": 0,
                    "contratado": 0, "facturado": 0, "cobrado": 0, "contratos": 0,
                }
            by_bu[emp]["ingresos"] += _to_float(r.get("ingresos"))
            by_bu[emp]["egresos"] += _to_float(r.get("egresos"))
            by_bu[emp]["flujo_neto"] += _to_float(r.get("flujo_neto"))

        for c in contratos:
            emp = c.get("empresa", "Sin empresa")
            if emp not in by_bu:
                by_bu[emp] = {
                    "empresa": emp,
                    "ingresos": 0, "egresos": 0, "flujo_neto": 0,
                    "contratado": 0, "facturado": 0, "cobrado": 0, "contratos": 0,
                }
            by_bu[emp]["contratado"] += _to_float(c.get("monto_contrato"))
            by_bu[emp]["facturado"] += _to_float(c.get("monto_facturado"))
            by_bu[emp]["cobrado"] += _to_float(c.get("monto_cobrado"))
            by_bu[emp]["contratos"] += 1

        return JSONResponse({"business_units": list(by_bu.values())})
    except Exception as e:
        logger.error(f"board_bu_comparison error: {e}")
        return _err(str(e), 500)


# ═════════════════════════════════════════════════════════════════════════════
# M12: ADMIN & CONFIGURATION
# ═════════════════════════════════════════════════════════════════════════════

async def admin_system_health(request: Request) -> JSONResponse:
    """GET /tms/admin/health — System health: entity counts, recent activity."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        entity_counts: dict[str, int] = {}
        for entity_name, config in ENTITY_CONFIG.items():
            try:
                rows = await _supabase.select(config["table"], limit=1)
                count_resp = await _supabase.count(config["table"])
                entity_counts[entity_name] = count_resp
            except Exception:
                entity_counts[entity_name] = -1

        # Recent audit log
        audit = await _supabase.select("tms.audit_log", order="created_at.desc", limit=20)

        # Recent notifications
        notifs = await _supabase.select("tms.notifications", order="created_at.desc", limit=10)

        # Business rules count
        rules = await _supabase.select("tms.business_rules", limit=100)

        return JSONResponse({
            "entity_counts": entity_counts,
            "total_entities": len(ENTITY_CONFIG),
            "recent_audit": audit[:10],
            "recent_notifications": notifs[:5],
            "business_rules_count": len(rules),
            "roles": list(ROLE_PERMISSIONS.keys()),
        })
    except Exception as e:
        logger.error(f"admin_system_health error: {e}")
        return _err(str(e), 500)


async def admin_cdc_status(request: Request) -> JSONResponse:
    """GET /tms/admin/cdc-status — CDC pipeline status from recent sync data."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)

    try:
        # Check sync timestamps from ERP-synced entities
        sync_status = []
        erp_entities = [
            ("productos", "tms.productos"),
            ("proveedores", "tms.proveedores"),
            ("clientes", "tms.clientes"),
            ("facturas", "tms.facturas"),
            ("ordenes_compra", "tms.ordenes_compra"),
            ("cuentas_por_pagar", "tms.cuentas_por_pagar"),
            ("cuentas_por_cobrar", "tms.cuentas_por_cobrar"),
            ("movimientos_bancarios", "tms.movimientos_bancarios"),
            ("tipos_cambio", "tms.tipos_cambio"),
        ]

        today = datetime.now(timezone.utc)

        for name, table in erp_entities:
            try:
                rows = await _supabase.select(table, order="_synced_at.desc", limit=1)
                if rows:
                    last_sync = rows[0].get("_synced_at", "")
                    try:
                        sync_dt = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
                        age_minutes = (today - sync_dt).total_seconds() / 60
                        status = "fresh" if age_minutes < 10 else "stale" if age_minutes < 60 else "outdated"
                    except (ValueError, TypeError):
                        age_minutes = -1
                        status = "unknown"
                    sync_status.append({
                        "entity": name,
                        "table": table,
                        "last_sync": last_sync,
                        "age_minutes": round(age_minutes, 1),
                        "status": status,
                    })
                else:
                    sync_status.append({"entity": name, "table": table, "last_sync": None, "age_minutes": -1, "status": "empty"})
            except Exception:
                sync_status.append({"entity": name, "table": table, "last_sync": None, "age_minutes": -1, "status": "error"})

        return JSONResponse({"cdc_status": sync_status, "checked_at": today.isoformat()})
    except Exception as e:
        logger.error(f"admin_cdc_status error: {e}")
        return _err(str(e), 500)
