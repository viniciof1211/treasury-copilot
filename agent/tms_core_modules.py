"""
TMS Phase 2 — Core Module Analytics API
Specialized endpoints for M1 Cash, M2 CxP, M3 CxC, M6 Invoicing.

These go beyond basic CRUD (handled by tms_engine.py) and provide:
  - Aggregated KPIs and dashboards
  - Aging analysis
  - Cash position calculations
  - Payment scheduling & approval summaries
  - Collection worklists
  - Liquidity gap analysis
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
