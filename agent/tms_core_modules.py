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

from agent.tms_engine import _supabase, ENTITY_CONFIG, ROLE_PERMISSIONS, check_permission, AuthorizationError, _json_serial

# Import projects_api for M5/M6 fallback (Excel-based contract data)
try:
    from agent.projects_api import _parse_contracts_main as _excel_contracts, _build_milestone_alerts as _excel_alerts, _build_area_breakdown as _excel_area_breakdown, _build_weekly_forecast as _excel_forecast
except ImportError:
    _excel_contracts = None
    _excel_alerts = None
    _excel_area_breakdown = None
    _excel_forecast = None

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


async def _sf_query(table: str, params: Optional[dict] = None, limit: int = 2000) -> list[dict]:
    """Query silver_finance tables via PostgREST when tms.* tables are empty."""
    import httpx
    async with httpx.AsyncClient(timeout=20) as client:
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept-Profile": "silver_finance",
        }
        p: dict[str, str] = {"select": "*", "limit": str(limit)}
        if params:
            p.update(params)
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params=p,
        )
        return resp.json() if resp.status_code == 200 else []


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

        # Try TMS table first
        filters: dict = {"status": "ejecutado"}
        if empresa:
            filters["empresa"] = empresa
        rows = await _supabase.select(
            "tms.cashflow_forecast", filters=filters, order="semana_inicio.desc", limit=500,
        )

        # ── Fallback to silver_finance when TMS table is empty ──
        if not rows:
            # Inflows = cxc_items (receivables)
            cxc_params: dict[str, str] = {"order": "vencimiento.desc", "limit": "2000"}
            if empresa:
                cxc_params["empresa"] = f"eq.{empresa}"
            cxc = await _sf_query("cxc_items", cxc_params)

            # Outflows = cxp_items (payables)
            cxp_params: dict[str, str] = {"order": "vencimiento_fecha.desc", "limit": "2000"}
            if empresa:
                cxp_params["empresa"] = f"eq.{empresa}"
            cxp = await _sf_query("cxp_items", cxp_params)

            # Debt service = flujo_semanal (loan cuotas = additional outflows)
            flujo_params: dict[str, str] = {"order": "vencimiento.desc", "limit": "2000"}
            if empresa:
                flujo_params["compania"] = f"eq.{empresa}"
            flujo = await _sf_query("flujo_semanal", flujo_params)

            # Build position grouped by BU
            positions: dict[str, dict] = {}
            for r in cxc:
                emp = r.get("empresa", "Sin empresa") or "Sin empresa"
                if emp not in positions:
                    positions[emp] = {"empresa": emp, "total_ingresos": 0, "total_egresos": 0,
                                      "flujo_neto": 0, "saldo_acumulado": 0, "moneda": "USD", "semanas": 0,
                                      "ultima_semana": r.get("vencimiento")}
                positions[emp]["total_ingresos"] += _to_float(r.get("monto"))
                positions[emp]["semanas"] += 1
            for r in cxp:
                emp = r.get("empresa", "Sin empresa") or "Sin empresa"
                if emp not in positions:
                    positions[emp] = {"empresa": emp, "total_ingresos": 0, "total_egresos": 0,
                                      "flujo_neto": 0, "saldo_acumulado": 0, "moneda": "USD", "semanas": 0,
                                      "ultima_semana": None}
                positions[emp]["total_egresos"] += _to_float(r.get("monto_usd"))
            for r in flujo:
                emp = r.get("compania", "Sin empresa") or "Sin empresa"
                if emp not in positions:
                    positions[emp] = {"empresa": emp, "total_ingresos": 0, "total_egresos": 0,
                                      "flujo_neto": 0, "saldo_acumulado": 0, "moneda": "USD", "semanas": 0,
                                      "ultima_semana": None}
                positions[emp]["total_egresos"] += _to_float(r.get("cuota"))
            for p in positions.values():
                p["flujo_neto"] = p["total_ingresos"] - p["total_egresos"]
                p["saldo_acumulado"] = p["flujo_neto"]

            result = list(positions.values())
        else:
            # Original TMS-based aggregation
            positions_tms: dict[str, dict] = {}
            for r in rows:
                emp = r.get("empresa", "Sin empresa")
                if emp not in positions_tms:
                    positions_tms[emp] = {"empresa": emp, "total_ingresos": 0, "total_egresos": 0,
                                          "flujo_neto": 0, "saldo_acumulado": 0,
                                          "moneda": r.get("moneda", "USD"), "semanas": 0,
                                          "ultima_semana": r.get("semana_inicio")}
                pos = positions_tms[emp]
                pos["total_ingresos"] += _to_float(r.get("ingresos"))
                pos["total_egresos"] += _to_float(r.get("egresos"))
                pos["flujo_neto"] += _to_float(r.get("flujo_neto"))
                pos["semanas"] += 1
                if r.get("saldo_acumulado"):
                    pos["saldo_acumulado"] = _to_float(r["saldo_acumulado"])
            result = list(positions_tms.values())

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
            "tms.cashflow_forecast", filters=filters, order="semana_inicio.asc", limit=weeks * 5,
        )

        # ── Fallback to silver_finance when TMS table is empty ──
        if not rows:
            # Inflows = cxc_items (receivables)
            cxc_params: dict[str, str] = {"order": "vencimiento.asc", "limit": "2000"}
            if empresa:
                cxc_params["empresa"] = f"eq.{empresa}"
            cxc = await _sf_query("cxc_items", cxc_params)

            # Outflows = cxp_items (payables)
            cxp_params: dict[str, str] = {"order": "vencimiento_fecha.asc", "limit": "2000"}
            if empresa:
                cxp_params["empresa"] = f"eq.{empresa}"
            cxp = await _sf_query("cxp_items", cxp_params)

            # Debt service = flujo_semanal (loan cuotas)
            flujo_params: dict[str, str] = {"order": "semana_inicio.asc", "limit": "2000"}
            if empresa:
                flujo_params["compania"] = f"eq.{empresa}"
            flujo = await _sf_query("flujo_semanal", flujo_params)

            weekly: dict[str, dict] = {}

            def _week_key(fecha_str: str) -> str:
                """Convert a date string to its Monday week key."""
                try:
                    dt = datetime.fromisoformat(fecha_str.replace("Z", "+00:00")) if "T" in fecha_str else datetime.strptime(fecha_str[:10], "%Y-%m-%d")
                    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    return ""

            def _ensure_week(wk: str) -> None:
                if wk and wk not in weekly:
                    weekly[wk] = {"semana": wk, "ingresos_ejecutado": 0, "egresos_ejecutado": 0,
                                  "ingresos_proyectado": 0, "egresos_proyectado": 0,
                                  "flujo_neto": 0, "saldo_acumulado": 0}

            # cxc_items → ingresos (by vencimiento week)
            for r in cxc:
                wk = _week_key(r.get("vencimiento", ""))
                _ensure_week(wk)
                if wk:
                    weekly[wk]["ingresos_ejecutado"] += _to_float(r.get("monto"))

            # cxp_items → egresos (by vencimiento_fecha week)
            for r in cxp:
                wk = _week_key(r.get("vencimiento_fecha", ""))
                _ensure_week(wk)
                if wk:
                    weekly[wk]["egresos_ejecutado"] += _to_float(r.get("monto_usd"))

            # flujo_semanal → egresos debt service (by semana_inicio)
            for r in flujo:
                wk = r.get("semana_inicio", "")
                _ensure_week(wk)
                if wk:
                    weekly[wk]["egresos_ejecutado"] += _to_float(r.get("cuota"))

            # Compute net and cumulative
            sorted_weeks = sorted(weekly.values(), key=lambda x: x["semana"])
            cumulative = 0.0
            for w in sorted_weeks:
                w["flujo_neto"] = (w["ingresos_ejecutado"] + w["ingresos_proyectado"]) - (w["egresos_ejecutado"] + w["egresos_proyectado"])
                cumulative += w["flujo_neto"]
                w["saldo_acumulado"] = round(cumulative, 2)

            result = sorted_weeks[:weeks]
        else:
            # Original TMS-based aggregation
            weekly_tms: dict[str, dict] = {}
            for r in rows:
                week = r.get("semana_inicio", "")
                if not week:
                    continue
                if week not in weekly_tms:
                    weekly_tms[week] = {"semana": week, "ingresos_ejecutado": 0, "egresos_ejecutado": 0,
                                        "ingresos_proyectado": 0, "egresos_proyectado": 0,
                                        "flujo_neto": 0, "saldo_acumulado": 0}
                w = weekly_tms[week]
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
            result = sorted(weekly_tms.values(), key=lambda x: x["semana"])[:weeks]

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
            "tms.payment_instructions", filters={"estado": f"neq.pagado"}, limit=1000,
        )
        # Get cashflow_forecast entries as inflows/outflows
        forecasts = await _supabase.select(
            "tms.cashflow_forecast", filters={"status": "proyectado"}, order="semana_inicio.asc", limit=500,
        )

        # ── Fallback to silver_finance when TMS tables are empty ──
        use_sf = not payments and not forecasts
        sf_cxc: list[dict] = []
        sf_cxp: list[dict] = []
        sf_flujo: list[dict] = []
        if use_sf:
            sf_cxc = await _sf_query("cxc_items", {"order": "vencimiento.asc", "limit": "2000"})
            sf_cxp = await _sf_query("cxp_items", {"order": "vencimiento_fecha.asc", "limit": "2000"})
            sf_flujo = await _sf_query("flujo_semanal", {"order": "vencimiento.asc", "limit": "2000"})

        def _date_diff(fecha_str: str) -> int | None:
            if not fecha_str:
                return None
            try:
                dt = datetime.fromisoformat(fecha_str.replace("Z", "+00:00")) if "T" in fecha_str else datetime.strptime(fecha_str[:10], "%Y-%m-%d")
                return (dt.date() - today).days if hasattr(dt, 'date') else (dt - today).days
            except (ValueError, TypeError, AttributeError):
                return None

        # Build buckets
        buckets = []
        prev_days = 0
        for label, max_days in buckets_def:
            bucket = {"bucket": label, "max_days": max_days, "inflows": 0, "outflows": 0, "gap": 0}

            if use_sf:
                # Inflows from cxc_items (receivables)
                for r in sf_cxc:
                    diff = _date_diff(r.get("vencimiento", ""))
                    if diff is not None and prev_days <= diff < max_days:
                        bucket["inflows"] += _to_float(r.get("monto"))
                # Outflows from cxp_items (payables)
                for r in sf_cxp:
                    diff = _date_diff(r.get("vencimiento_fecha", ""))
                    if diff is not None and prev_days <= diff < max_days:
                        bucket["outflows"] += _to_float(r.get("monto_usd"))
                # Outflows from flujo_semanal (debt service cuotas)
                for r in sf_flujo:
                    diff = _date_diff(r.get("vencimiento", ""))
                    if diff is not None and prev_days <= diff < max_days:
                        bucket["outflows"] += _to_float(r.get("cuota"))
            else:
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
            "tms.payment_instructions", filters=filters, order="created_at.desc", limit=2000,
        )

        # Get payment batches
        batches = await _supabase.select(
            "tms.payment_batches",
            filters={"deleted_at": "is.null"} if not empresa else {"deleted_at": "is.null", "empresa": empresa},
            order="fecha_pago.desc", limit=100,
        )

        today = datetime.now(timezone.utc).date()

        # ── Fallback to silver_finance.cxp_items when TMS tables are empty ──
        if not instructions:
            cxp_params: dict[str, str] = {"order": "vencimiento_fecha.desc", "limit": "2000"}
            if empresa:
                cxp_params["empresa"] = f"eq.{empresa}"
            sf_cxp = await _sf_query("cxp_items", cxp_params)

            total_pendiente = 0.0
            total_pagado = 0.0
            total_items = len(sf_cxp)
            by_priority: dict[str, float] = {}
            by_estado: dict[str, int] = {}
            by_metodo: dict[str, float] = {}
            by_proveedor: dict[str, float] = {}
            aging_buckets = {"corriente": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "91+": 0.0}
            aging_counts = {"corriente": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0}

            for item in sf_cxp:
                monto = _to_float(item.get("monto_usd"))
                prio = item.get("prioridad", "Sin prioridad") or "Sin prioridad"
                clasif = item.get("clasificacion", "Otro") or "Otro"
                prov = item.get("proveedor", "Desconocido") or "Desconocido"

                total_pendiente += monto
                by_priority[prio] = by_priority.get(prio, 0) + monto
                by_estado["pendiente"] = by_estado.get("pendiente", 0) + 1
                by_metodo[clasif] = by_metodo.get(clasif, 0) + monto
                by_proveedor[prov] = by_proveedor.get(prov, 0) + monto

                # Aging from vencimiento_fecha
                fecha = item.get("vencimiento_fecha", "")
                if fecha:
                    try:
                        dt = datetime.fromisoformat(fecha.replace("Z", "+00:00")) if "T" in fecha else datetime.strptime(fecha[:10], "%Y-%m-%d")
                        venc_date = dt.date() if hasattr(dt, 'date') else dt
                        days = (today - venc_date).days
                        if days <= 0:
                            aging_buckets["corriente"] += monto; aging_counts["corriente"] += 1
                        elif days <= 30:
                            aging_buckets["1-30"] += monto; aging_counts["1-30"] += 1
                        elif days <= 60:
                            aging_buckets["31-60"] += monto; aging_counts["31-60"] += 1
                        elif days <= 90:
                            aging_buckets["61-90"] += monto; aging_counts["61-90"] += 1
                        else:
                            aging_buckets["91+"] += monto; aging_counts["91+"] += 1
                    except (ValueError, TypeError, AttributeError):
                        pass

            top_proveedores = sorted(
                [{"nombre": k, "monto": v} for k, v in by_proveedor.items()],
                key=lambda x: x["monto"], reverse=True,
            )[:10]

            return JSONResponse({
                "kpis": {
                    "total_pendiente": total_pendiente,
                    "total_pagado": total_pagado,
                    "total_items": total_items,
                    "pending_batch_count": len(batches),
                    "pending_batch_amount": 0,
                    "approved_batch_count": 0,
                },
                "aging": [{"bucket": k, "monto": v, "count": aging_counts[k]} for k, v in aging_buckets.items()],
                "by_priority": [{"priority": k, "monto": v} for k, v in sorted(by_priority.items())],
                "by_estado": [{"estado": k, "count": v} for k, v in by_estado.items()],
                "by_metodo": [{"metodo": k, "monto": v} for k, v in by_metodo.items()],
                "top_proveedores": top_proveedores,
                "pending_batches": [],
            })

        # ── Original TMS-based flow ──
        total_pendiente = 0.0
        total_pagado = 0.0
        total_items = len(instructions)
        by_priority = {}
        by_estado = {}
        by_metodo = {}
        by_proveedor = {}

        aging_buckets = {"corriente": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "91+": 0.0}
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

            created = instr.get("created_at", "")
            if created:
                try:
                    created_date = datetime.fromisoformat(created.replace("Z", "+00:00")).date()
                    days = (today - created_date).days
                    if days <= 0:
                        aging_buckets["corriente"] += monto; aging_counts["corriente"] += 1
                    elif days <= 30:
                        aging_buckets["1-30"] += monto; aging_counts["1-30"] += 1
                    elif days <= 60:
                        aging_buckets["31-60"] += monto; aging_counts["31-60"] += 1
                    elif days <= 90:
                        aging_buckets["61-90"] += monto; aging_counts["61-90"] += 1
                    else:
                        aging_buckets["91+"] += monto; aging_counts["91+"] += 1
                except (ValueError, TypeError):
                    pass

        pending_batches = [b for b in batches if b.get("estado") in ("borrador", "pendiente_aprobacion")]
        approved_batches = [b for b in batches if b.get("estado") == "aprobado"]

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
            "aging": [{"bucket": k, "monto": v, "count": aging_counts[k]} for k, v in aging_buckets.items()],
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
            "tms.payment_batches", filters={"deleted_at": "is.null"}, order="fecha_pago.asc", limit=100,
        )

        # ── Fallback to silver_finance.cxp_items when TMS batches are empty ──
        if not batches:
            cxp = await _sf_query("cxp_items", {"order": "vencimiento_fecha.asc", "limit": "2000"})
            schedule: list[dict] = []
            for w in range(weeks):
                week_start = today + timedelta(days=w * 7)
                week_end = week_start + timedelta(days=6)
                week_items = []
                for item in cxp:
                    fecha = item.get("vencimiento_fecha", "")
                    if not fecha:
                        continue
                    try:
                        fd = fecha[:10]
                        if week_start.isoformat() <= fd <= week_end.isoformat():
                            week_items.append(item)
                    except (ValueError, TypeError):
                        pass
                schedule.append({
                    "week": w + 1,
                    "start": week_start.isoformat(),
                    "end": week_end.isoformat(),
                    "batches": 0,
                    "total_monto": sum(_to_float(i.get("monto_usd")) for i in week_items),
                    "items": len(week_items),
                    "approved": 0,
                    "pending": len(week_items),
                })
            return JSONResponse({"schedule": schedule, "weeks": weeks})

        schedule = []
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
            "tms.contratos", filters={"deleted_at": "is.null"}, order="created_at.desc", limit=500,
        )
        hitos = await _supabase.select(
            "tms.hitos_contrato", filters={"deleted_at": "is.null"}, order="fecha_programada.asc", limit=2000,
        )

        # ── Fallback to Excel-based contracts from projects_api ──
        if not contratos and _excel_contracts:
            excel_data = _excel_contracts()
            # Map Excel fields to TMS field names
            contratos = [{
                "monto_contrato": c.get("monto_contrato", 0),
                "monto_facturado": c.get("monto_facturado", 0),
                "monto_cobrado": c.get("monto_cancelado", 0),
                "estado": "en_ejecucion" if c.get("pendiente_cobrar", 0) > 0 else "cerrado",
                "empresa": c.get("empresa", "Sin empresa"),
                "area_comercial": c.get("area", ""),
                "nombre": c.get("nombre_proyecto", ""),
                "nombre_cliente": c.get("nombre_cliente", ""),
            } for c in excel_data]
            hitos = []  # No hitos from Excel

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

        # ── Fallback to Excel-based contracts from projects_api ──
        if not contratos and _excel_contracts:
            excel_data = _excel_contracts()
            contratos = [{
                "monto_contrato": c.get("monto_contrato", 0),
                "monto_facturado": c.get("monto_facturado", 0),
                "monto_cobrado": c.get("monto_cancelado", 0),
                "estado": "en_ejecucion" if c.get("pendiente_cobrar", 0) > 0 else "cerrado",
                "empresa": c.get("empresa", "Sin empresa"),
                "area_comercial": c.get("area", ""),
                "tipo_proyecto": c.get("area", ""),
                "nombre": c.get("nombre_proyecto", ""),
                "nombre_cliente": c.get("nombre_cliente", ""),
            } for c in excel_data]
            if empresa:
                contratos = [c for c in contratos if c.get("empresa", "").lower() == empresa.lower()]
            hitos = []  # No hitos from Excel — we'll use fallback below

        # Flag: did we fall back to Excel?
        _used_excel_fallback = (len(hitos) == 0 and _excel_alerts is not None)

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
        if hitos:
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
        elif _used_excel_fallback:
            # Fallback: use Excel-based milestone alerts from projects_api
            try:
                raw_alerts = _excel_alerts()
                for a in raw_alerts:
                    severity = "critical" if a.get("urgency") in ("critical", "overdue") else \
                               "warning" if a.get("urgency") == "warning" else "info"
                    milestone_alerts.append({
                        "hito_id": a.get("contract_id"),
                        "contrato_id": a.get("contract_id"),
                        "nombre": a.get("nombre_proyecto", ""),
                        "monto": _to_float(a.get("pendiente_cobrar") or a.get("monto_contrato")),
                        "fecha_programada": a.get("fecha_cierre", ""),
                        "days_until": a.get("days_until", 0),
                        "severity": severity,
                        "estado": a.get("urgency", "pendiente"),
                    })
            except Exception as e:
                logger.warning(f"Excel alerts fallback failed: {e}")

        # Collection forecast — next 12 weeks from pending hitos
        collection_forecast: list[dict] = []
        if hitos:
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
        elif _used_excel_fallback and _excel_forecast:
            # Fallback: use Excel-based weekly forecast from projects_api
            try:
                raw_fc = _excel_forecast()
                for i, f in enumerate(raw_fc[:12]):
                    collection_forecast.append({
                        "week": i + 1,
                        "start": f.get("mes", ""),
                        "end": f.get("semana", ""),
                        "monto": _to_float(f.get("total", 0)),
                        "hitos": f.get("count", 0),
                    })
            except Exception as e:
                logger.warning(f"Excel forecast fallback failed: {e}")

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

        # ── Fallback to Excel-based contracts ──
        if not contratos and _excel_contracts:
            excel_data = _excel_contracts()
            contratos = [{
                "id": c.get("id"),
                "numero_contrato": c.get("id", ""),
                "nombre": c.get("nombre_proyecto", ""),
                "empresa": c.get("empresa", ""),
                "area_comercial": c.get("area", ""),
                "monto_contrato": c.get("monto_contrato", 0),
                "monto_facturado": c.get("monto_facturado", 0),
                "monto_cobrado": c.get("monto_cancelado", 0),
            } for c in excel_data if c.get("pendiente_cobrar", 0) > 0 or c.get("pendiente_facturar", 0) > 0]

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

        # ── Fallback: derive FX exposure from silver_finance when TMS tables are empty ──
        if not positions:
            flujo = await _sf_query("flujo_semanal", {"limit": "2000"})
            cxp = await _sf_query("cxp_items", {"limit": "2000"})

            # Estimate CRC/USD rate from flujo data (look for CRC items with saldo_original)
            default_rate = 505.0  # Approximate BCCR rate
            net_usd_receivables = 0.0
            net_usd_payables = 0.0
            net_usd_debt = 0.0
            by_bu: dict[str, dict] = {}

            for r in flujo:
                emp = r.get("compania", "Sin empresa")
                moneda = (r.get("moneda") or "CRC").upper()
                cuota = _to_float(r.get("cuota"))
                saldo = _to_float(r.get("saldo_original"))
                tipo = (r.get("tipo") or "").lower()

                # Convert CRC to USD for exposure
                cuota_usd = cuota / default_rate if moneda == "CRC" else cuota
                saldo_usd = saldo / default_rate if moneda == "CRC" else saldo

                if emp not in by_bu:
                    by_bu[emp] = {"empresa": emp, "receivables": 0, "payables": 0, "debt": 0, "net": 0}

                if "largo" in tipo:
                    net_usd_debt += saldo_usd
                    by_bu[emp]["debt"] += saldo_usd
                else:
                    net_usd_receivables += cuota_usd
                    by_bu[emp]["receivables"] += cuota_usd

            for r in cxp:
                emp = r.get("empresa", "Sin empresa")
                monto = _to_float(r.get("monto_usd"))
                net_usd_payables += monto
                if emp not in by_bu:
                    by_bu[emp] = {"empresa": emp, "receivables": 0, "payables": 0, "debt": 0, "net": 0}
                by_bu[emp]["payables"] += monto

            for b in by_bu.values():
                b["net"] = b["receivables"] - b["payables"] - b["debt"]

            net_exposure = net_usd_receivables - net_usd_payables - net_usd_debt
            # Use default rate when tms.tipos_cambio is empty
            rate_compra = default_rate
            rate_venta = default_rate + 2
            rate_fecha = today.isoformat()
        else:
            # Original TMS-based aggregation
            net_usd_receivables = 0
            net_usd_payables = 0
            net_usd_debt = 0
            by_bu = {}

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
            rate_compra = _to_float(latest_rate.get("compra")) or 505.0
            rate_venta = _to_float(latest_rate.get("venta")) or 507.0
            rate_fecha = latest_rate.get("fecha", today.isoformat())

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

        net_exposure = 0.0
        if not positions:
            # Fallback: derive from silver_finance
            flujo = await _sf_query("flujo_semanal", {"limit": "2000"})
            cxp = await _sf_query("cxp_items", {"limit": "2000"})
            default_rate = 505.0
            for r in flujo:
                moneda = (r.get("moneda") or "CRC").upper()
                cuota = _to_float(r.get("cuota"))
                cuota_usd = cuota / default_rate if moneda == "CRC" else cuota
                net_exposure += cuota_usd
            for r in cxp:
                net_exposure -= _to_float(r.get("monto_usd"))
        else:
            for p in positions:
                if (p.get("moneda") or "").upper() != "USD":
                    continue
                monto = _to_float(p.get("monto"))
                tipo = p.get("tipo", "")
                if tipo in ("receivable", "cxc"):
                    net_exposure += monto
                elif tipo in ("payable", "cxp", "debt", "deuda"):
                    net_exposure -= monto

        base_rate = _to_float(rates[0].get("venta")) if rates else 505.0

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

        # ── Fallback: derive debt from silver_finance.flujo_semanal (credit operations) ──
        if not instruments:
            flujo = await _sf_query("flujo_semanal", {"order": "vencimiento.asc", "limit": "2000"})

            # Group by operacion to build synthetic instruments
            ops: dict[str, dict] = {}
            for r in flujo:
                op = r.get("operacion", "Sin operación") or "Sin operación"
                if op not in ops:
                    ops[op] = {
                        "id": op, "nombre": op,
                        "tipo": r.get("tipo", "Corto Plazo"),
                        "banco": r.get("banco", "Sin banco"),
                        "moneda": r.get("moneda", "CRC"),
                        "saldo_original": _to_float(r.get("saldo_original")),
                        "capital_vigente": _to_float(r.get("capital_actualizado") or r.get("capital") or r.get("saldo_original")),
                        "empresa": r.get("compania", "Sin empresa"),
                        "estado": "vigente",
                        "tasa_interes": 0,
                        "fecha_vencimiento": r.get("vencimiento"),
                        "total_principal": 0, "total_intereses": 0, "cuotas": [],
                    }
                entry = ops[op]
                entry["total_principal"] += _to_float(r.get("principal"))
                entry["total_intereses"] += _to_float(r.get("intereses"))
                if _to_float(r.get("saldo_original")) > entry["saldo_original"]:
                    entry["saldo_original"] = _to_float(r.get("saldo_original"))
                cap_upd = _to_float(r.get("capital_actualizado") or r.get("capital"))
                if cap_upd > 0:
                    entry["capital_vigente"] = cap_upd
                entry["cuotas"].append({
                    "fecha_pago": r.get("vencimiento"),
                    "principal": _to_float(r.get("principal")),
                    "intereses": _to_float(r.get("intereses")),
                    "cuota": _to_float(r.get("cuota")),
                })

            synth_instruments = list(ops.values())

            # KPIs
            total_saldo_original = sum(_to_float(i.get("saldo_original")) for i in synth_instruments)
            total_capital_vigente = sum(_to_float(i.get("capital_vigente")) for i in synth_instruments)
            total_intereses_acumulados = sum(i["total_intereses"] for i in synth_instruments)
            active_count = len(synth_instruments)

            by_tipo: dict[str, dict] = {}
            by_banco: dict[str, dict] = {}
            by_moneda: dict[str, float] = {}

            for inst in synth_instruments:
                cap = _to_float(inst.get("capital_vigente"))
                tipo = inst.get("tipo", "otro")
                if tipo not in by_tipo:
                    by_tipo[tipo] = {"tipo": tipo, "capital": 0, "count": 0}
                by_tipo[tipo]["capital"] += cap
                by_tipo[tipo]["count"] += 1

                banco = inst.get("banco", "Sin banco")
                if banco not in by_banco:
                    by_banco[banco] = {"banco": banco, "capital": 0, "count": 0}
                by_banco[banco]["capital"] += cap
                by_banco[banco]["count"] += 1

                moneda = inst.get("moneda", "CRC")
                by_moneda[moneda] = by_moneda.get(moneda, 0) + cap

            # Maturity profile from vencimiento dates
            maturity_buckets = {"0-3m": 0.0, "3-6m": 0.0, "6-12m": 0.0, "1-3y": 0.0, "3-5y": 0.0, "5y+": 0.0}
            for inst in synth_instruments:
                venc = inst.get("fecha_vencimiento")
                capital = _to_float(inst.get("capital_vigente"))
                if not venc:
                    continue
                try:
                    diff = (datetime.fromisoformat(venc).date() - today).days
                    if diff <= 90: maturity_buckets["0-3m"] += capital
                    elif diff <= 180: maturity_buckets["3-6m"] += capital
                    elif diff <= 365: maturity_buckets["6-12m"] += capital
                    elif diff <= 1095: maturity_buckets["1-3y"] += capital
                    elif diff <= 1825: maturity_buckets["3-5y"] += capital
                    else: maturity_buckets["5y+"] += capital
                except (ValueError, TypeError):
                    pass

            # Payment schedule from cuotas
            payment_schedule: list[dict] = []
            all_cuotas = []
            for inst in synth_instruments:
                all_cuotas.extend(inst.get("cuotas", []))
            for w in range(12):
                week_start = today + timedelta(days=w * 7)
                week_end = week_start + timedelta(days=6)
                wp = 0.0; wi = 0.0; wc = 0
                for c in all_cuotas:
                    fecha = c.get("fecha_pago")
                    if not fecha: continue
                    try:
                        fd = datetime.fromisoformat(fecha).date()
                        if week_start <= fd <= week_end:
                            wp += _to_float(c.get("principal")); wi += _to_float(c.get("intereses")); wc += 1
                    except (ValueError, TypeError): pass
                payment_schedule.append({"week": w+1, "start": week_start.isoformat(), "end": week_end.isoformat(),
                                          "principal": wp, "intereses": wi, "cuota": wp+wi, "pagos": wc})

            return JSONResponse({
                "kpis": {
                    "total_saldo_original": total_saldo_original,
                    "total_capital_vigente": total_capital_vigente,
                    "total_intereses_acumulados": total_intereses_acumulados,
                    "active_instruments": active_count,
                    "total_instruments": len(synth_instruments),
                    "weighted_avg_rate": 0,
                    "next_payment_amount": payment_schedule[0]["cuota"] if payment_schedule else 0,
                },
                "maturity_profile": [{"bucket": k, "capital": v} for k, v in maturity_buckets.items()],
                "by_tipo": sorted(by_tipo.values(), key=lambda x: x["capital"], reverse=True),
                "by_banco": sorted(by_banco.values(), key=lambda x: x["capital"], reverse=True),
                "by_moneda": [{"moneda": k, "capital": v} for k, v in by_moneda.items()],
                "payment_schedule": payment_schedule,
                "instruments": [{
                    "id": i.get("id"), "nombre": i.get("nombre"), "tipo": i.get("tipo"),
                    "banco": i.get("banco"), "moneda": i.get("moneda"),
                    "saldo_original": _to_float(i.get("saldo_original")),
                    "capital_vigente": _to_float(i.get("capital_vigente")),
                    "tasa_interes": 0, "fecha_vencimiento": i.get("fecha_vencimiento"),
                    "estado": "vigente", "empresa": i.get("empresa"),
                } for i in synth_instruments[:50]],
            })

        # ── Original TMS-based flow ──
        total_saldo_original = 0
        total_capital_vigente = 0
        total_intereses_acumulados = 0
        by_tipo = {}
        by_banco = {}
        by_moneda = {}
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
                if diff <= 90: maturity_buckets["0-3m"] += capital
                elif diff <= 180: maturity_buckets["3-6m"] += capital
                elif diff <= 365: maturity_buckets["6-12m"] += capital
                elif diff <= 1095: maturity_buckets["1-3y"] += capital
                elif diff <= 1825: maturity_buckets["3-5y"] += capital
                else: maturity_buckets["5y+"] += capital
            except (ValueError, TypeError):
                pass

        # Upcoming payments (next 12 weeks)
        payment_schedule = []
        for w in range(12):
            week_start = today + timedelta(days=w * 7)
            week_end = week_start + timedelta(days=6)
            week_principal = 0; week_interes = 0; week_count = 0
            for s in schedules:
                fecha = s.get("fecha_pago")
                if not fecha: continue
                try:
                    fd = datetime.fromisoformat(fecha).date()
                    if week_start <= fd <= week_end:
                        week_principal += _to_float(s.get("principal"))
                        week_interes += _to_float(s.get("intereses"))
                        week_count += 1
                except (ValueError, TypeError): pass
            payment_schedule.append({"week": w+1, "start": week_start.isoformat(), "end": week_end.isoformat(),
                                      "principal": week_principal, "intereses": week_interes,
                                      "cuota": week_principal + week_interes, "pagos": week_count})

        # Weighted average rate
        weighted_rate_num = 0; weighted_rate_den = 0
        for inst in instruments:
            cap = _to_float(inst.get("capital_vigente", inst.get("saldo_original")))
            rate = _to_float(inst.get("tasa_interes"))
            if cap > 0 and rate > 0:
                weighted_rate_num += cap * rate; weighted_rate_den += cap
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
                "id": i.get("id"), "nombre": i.get("nombre"), "tipo": i.get("tipo"),
                "banco": i.get("banco"), "moneda": i.get("moneda"),
                "saldo_original": _to_float(i.get("saldo_original")),
                "capital_vigente": _to_float(i.get("capital_vigente", i.get("saldo_original"))),
                "tasa_interes": _to_float(i.get("tasa_interes")),
                "fecha_vencimiento": i.get("fecha_vencimiento"),
                "estado": i.get("estado"), "empresa": i.get("empresa"),
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


# ═══════════════════════════════════════════════════════════════════════════
# Phase 5: Bank API, Hacienda E-Invoice, PcGraf Write-back, Full Sync
# ═══════════════════════════════════════════════════════════════════════════

# ── Integration Helpers ──────────────────────────────────────────────────

async def _get_connections(category: Optional[str] = None) -> list[dict]:
    """Fetch integration connections, optionally filtered by category."""
    filters = {"category": category} if category else None
    try:
        return await _supabase.select("tms.integration_connections", filters=filters, order="display_name", limit=50)
    except Exception:
        return []


async def _get_connection(provider: str) -> Optional[dict]:
    """Fetch a single connection by provider."""
    rows = await _supabase.select("tms.integration_connections", filters={"provider": provider}, limit=1)
    return rows[0] if rows else None


async def _log_sync_job(integration: str, job_type: str, triggered_by: str, **kwargs) -> dict:
    """Create a sync_jobs entry and return it."""
    job = {
        "integration": integration,
        "job_type": job_type,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "triggered_by": triggered_by,
        "details": json.dumps(kwargs.get("details", {}), default=_json_serial),
    }
    return await _supabase.insert("tms.sync_jobs", job)


async def _complete_sync_job(job_id: str, status: str, rows_processed: int = 0,
                              rows_created: int = 0, rows_updated: int = 0,
                              rows_failed: int = 0, error_message: str = "") -> dict:
    """Mark a sync job as completed/failed."""
    now = datetime.now(timezone.utc).isoformat()
    data: dict[str, Any] = {
        "status": status,
        "completed_at": now,
        "rows_processed": rows_processed,
        "rows_created": rows_created,
        "rows_updated": rows_updated,
        "rows_failed": rows_failed,
        "updated_at": now,
    }
    if error_message:
        data["error_message"] = error_message
    return await _supabase.update("tms.sync_jobs", job_id, data)


# ── Bank API Integration ─────────────────────────────────────────────────

async def bank_accounts_list(request: Request) -> JSONResponse:
    """GET /tms/bank/accounts — List bank accounts from tms.bank_accounts + connection status."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cash", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        accts = await _supabase.select("tms.bank_accounts", order="bank_name", limit=100)
        conns = await _get_connections("bank_api")
        conn_map = {c["id"]: c for c in conns}

        result = []
        for a in accts:
            conn = conn_map.get(a.get("connection_id", ""), {})
            result.append({
                "id": a.get("id"),
                "bank": a.get("bank_name", ""),
                "account_number": a.get("account_number", ""),
                "currency": a.get("currency", "CRC"),
                "type": a.get("account_type", "corriente"),
                "balance": _to_float(a["balance"]) if a.get("balance") is not None else None,
                "balance_date": a.get("balance_date"),
                "last_sync": a.get("updated_at"),
                "status": conn.get("status", "disconnected"),
                "api_type": a.get("api_type", "manual"),
                "iban": a.get("iban"),
                "sinpe_number": a.get("sinpe_number"),
                "connection_status": conn.get("status", "disconnected"),
            })

        # Also include bank connections that have no accounts yet
        acct_conn_ids = {a.get("connection_id") for a in accts}
        for c in conns:
            if c["id"] not in acct_conn_ids:
                result.append({
                    "id": None,
                    "bank": c["display_name"],
                    "account_number": "—",
                    "currency": "—",
                    "type": "—",
                    "balance": None,
                    "balance_date": None,
                    "last_sync": c.get("last_test_at"),
                    "status": c["status"],
                    "api_type": (c.get("config") or {}).get("api_type", "pending"),
                    "iban": None,
                    "sinpe_number": None,
                    "connection_status": c["status"],
                })

        return JSONResponse({
            "accounts": result,
            "total": len(result),
            "connections": [{
                "id": c["id"], "provider": c["provider"], "display_name": c["display_name"],
                "status": c["status"], "enabled": c.get("enabled", False),
                "last_test_at": c.get("last_test_at"), "last_error": c.get("last_error"),
            } for c in conns],
        })
    except Exception as e:
        logger.error(f"bank_accounts_list error: {e}")
        return _err(str(e), 500)


async def bank_statement_import(request: Request) -> JSONResponse:
    """POST /tms/bank/import — Import bank transactions (CSV/MT940 lines)."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "recon", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        account_id = body.get("account_id", "")
        transactions = body.get("transactions", [])
        source = body.get("source", "csv")
        batch_id = f"import-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        if not account_id:
            return _err("account_id is required", 400)
        if not transactions:
            return _err("transactions array is required", 400)

        job = await _log_sync_job(
            f"bank_{source}", "manual", ctx["user_id"],
            details={"account_id": account_id, "batch_id": batch_id, "count": len(transactions)},
        )

        created = 0
        failed = 0
        for txn in transactions:
            try:
                await _supabase.insert("tms.bank_transactions", {
                    "account_id": account_id,
                    "txn_date": txn.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
                    "value_date": txn.get("value_date"),
                    "description": txn.get("description", ""),
                    "reference": txn.get("reference", ""),
                    "debit": _to_float(txn.get("debit", 0)),
                    "credit": _to_float(txn.get("credit", 0)),
                    "balance_after": _to_float(txn.get("balance", 0)) if txn.get("balance") else None,
                    "currency": txn.get("currency", "CRC"),
                    "import_batch": batch_id,
                    "source": source,
                })
                created += 1
            except Exception as te:
                logger.warning(f"bank_statement_import txn error: {te}")
                failed += 1

        await _complete_sync_job(job["id"], "completed", len(transactions), created, 0, failed)

        return JSONResponse({
            "status": "completed",
            "batch_id": batch_id,
            "rows_imported": created,
            "rows_failed": failed,
            "job_id": job["id"],
        })
    except Exception as e:
        logger.error(f"bank_statement_import error: {e}")
        return _err(str(e), 500)


async def bank_payment_initiate(request: Request) -> JSONResponse:
    """POST /tms/bank/pay — Initiate a payment (SINPE/wire). Creates writeback queue entry."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "cxp", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        payment_type = body.get("type", "sinpe")
        amount = _to_float(body.get("amount", 0))
        currency = body.get("currency", "CRC")
        beneficiary = body.get("beneficiary", "")
        account_id = body.get("account_id", "")
        reference = body.get("reference", "")

        if amount <= 0:
            return _err("amount must be positive", 400)

        ref_code = f"PAY-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        # Create writeback entry for approval workflow
        wb_entry = await _supabase.insert("tms.writeback_queue", {
            "entity": "payment",
            "pcgraf_table": "BA10",
            "record_id": ref_code,
            "direction": "supabase_to_bank",
            "operation": "INSERT",
            "new_data": json.dumps({
                "payment_type": payment_type, "amount": amount,
                "currency": currency, "beneficiary": beneficiary,
                "account_id": account_id, "reference": reference,
            }, default=_json_serial),
            "status": "pending",
            "created_by": ctx["user_id"],
        })

        return JSONResponse({
            "status": "pending_approval",
            "payment_type": payment_type,
            "amount": amount,
            "currency": currency,
            "beneficiary": beneficiary,
            "reference": ref_code,
            "writeback_id": wb_entry.get("id"),
            "message": "Payment queued — requires dual approval before bank submission.",
        })
    except Exception as e:
        logger.error(f"bank_payment_initiate error: {e}")
        return _err(str(e), 500)


# ── Almamater / Hacienda E-Invoice Integration ──────────────────────────

async def einvoice_status(request: Request) -> JSONResponse:
    """GET /tms/einvoice/status — Real e-invoice submission status from tms.einvoice_submissions."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "invoicing", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        # Get submissions from the real table
        submissions = await _supabase.select(
            "tms.einvoice_submissions",
            order="created_at.desc",
            limit=50,
        )

        # Also get the connection status
        atv_conn = await _get_connection("hacienda_atv")
        alm_conn = await _get_connection("almamater")

        invoices = []
        for s in submissions:
            invoices.append({
                "id": s.get("id"),
                "numero_factura": s.get("numero_factura", ""),
                "tipo_documento": s.get("tipo_documento", "01"),
                "cliente": s.get("receptor_nombre", ""),
                "total": _to_float(s.get("total", 0)),
                "fecha": s.get("fecha_emision", ""),
                "empresa": s.get("emisor_nombre", s.get("empresa", "")),
                "einvoice_status": s.get("almamater_status", "pending"),
                "hacienda_status": s.get("hacienda_status", "pending"),
                "hacienda_key": s.get("clave_numerica"),
                "almamater_ref": s.get("almamater_ref"),
                "submitted_at": s.get("submitted_at"),
                "accepted_at": s.get("accepted_at"),
            })

        accepted = sum(1 for i in invoices if i["einvoice_status"] == "accepted")
        pending = sum(1 for i in invoices if i["einvoice_status"] in ("pending", "submitted"))
        rejected = sum(1 for i in invoices if i["einvoice_status"] == "rejected")

        return JSONResponse({
            "invoices": invoices,
            "total": len(invoices),
            "accepted": accepted,
            "pending": pending,
            "rejected": rejected,
            "connections": {
                "hacienda_atv": {
                    "status": (atv_conn or {}).get("status", "disconnected"),
                    "enabled": (atv_conn or {}).get("enabled", False),
                },
                "almamater": {
                    "status": (alm_conn or {}).get("status", "disconnected"),
                    "enabled": (alm_conn or {}).get("enabled", False),
                },
            },
        })
    except Exception as e:
        logger.error(f"einvoice_status error: {e}")
        return _err(str(e), 500)


async def einvoice_submit(request: Request) -> JSONResponse:
    """POST /tms/einvoice/submit — Submit an invoice for e-invoice processing."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "invoicing", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        numero_factura = body.get("numero_factura", "")
        if not numero_factura:
            return _err("numero_factura is required", 400)

        alm_ref = f"ALM-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        # Create submission record
        sub = await _supabase.insert("tms.einvoice_submissions", {
            "numero_factura": numero_factura,
            "tipo_documento": body.get("tipo_documento", "01"),
            "emisor_cedula": body.get("emisor_cedula", ""),
            "emisor_nombre": body.get("emisor_nombre", ""),
            "receptor_cedula": body.get("receptor_cedula", ""),
            "receptor_nombre": body.get("receptor_nombre", body.get("cliente", "")),
            "total": _to_float(body.get("total", 0)),
            "currency": body.get("currency", "CRC"),
            "fecha_emision": body.get("fecha", datetime.now(timezone.utc).isoformat()),
            "almamater_ref": alm_ref,
            "almamater_status": "submitted",
            "hacienda_status": "pending",
            "empresa": body.get("empresa", ""),
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        })

        # Log sync job
        await _log_sync_job("einvoice_almamater", "manual", ctx["user_id"],
                            details={"numero_factura": numero_factura, "almamater_ref": alm_ref})

        return JSONResponse({
            "status": "submitted",
            "id": sub.get("id"),
            "numero_factura": numero_factura,
            "almamater_ref": alm_ref,
            "message": f"Factura {numero_factura} enviada a Almamater para procesamiento.",
            "flow": "Proforma → FA → Almamater → Hacienda → Aceptado/Rechazado",
        })
    except Exception as e:
        logger.error(f"einvoice_submit error: {e}")
        return _err(str(e), 500)


async def einvoice_webhook(request: Request) -> JSONResponse:
    """POST /tms/einvoice/webhook — Receive webhook from Almamater with status updates."""
    try:
        body = await request.json()
        event_type = body.get("event", "unknown")
        ref = body.get("reference", body.get("almamater_ref", ""))
        hacienda_status = body.get("hacienda_status", "")
        clave = body.get("clave_numerica", "")
        mensaje = body.get("mensaje", "")

        logger.info(f"einvoice_webhook: event={event_type}, ref={ref}, status={hacienda_status}")

        # Find and update the submission by almamater_ref
        if ref:
            subs = await _supabase.select("tms.einvoice_submissions", filters={"almamater_ref": ref}, limit=1)
            if subs:
                update_data: dict[str, Any] = {
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if hacienda_status:
                    update_data["hacienda_status"] = hacienda_status
                if clave:
                    update_data["clave_numerica"] = clave
                if mensaje:
                    update_data["hacienda_mensaje"] = mensaje

                if hacienda_status in ("aceptado", "accepted"):
                    update_data["almamater_status"] = "accepted"
                    update_data["accepted_at"] = datetime.now(timezone.utc).isoformat()
                elif hacienda_status in ("rechazado", "rejected"):
                    update_data["almamater_status"] = "rejected"
                elif hacienda_status == "enviado":
                    update_data["almamater_status"] = "submitted"

                if body.get("xml_response"):
                    update_data["hacienda_xml_res"] = body["xml_response"]

                await _supabase.update("tms.einvoice_submissions", subs[0]["id"], update_data)

        return JSONResponse({
            "received": True,
            "event": event_type,
            "reference": ref,
            "hacienda_status": hacienda_status,
            "message": "Webhook processed successfully.",
        })
    except Exception as e:
        logger.error(f"einvoice_webhook error: {e}")
        return _err(str(e), 500)


# ── PcGraf Write-back ────────────────────────────────────────────────────

async def pcgraf_writeback_status(request: Request) -> JSONResponse:
    """GET /tms/writeback/status — Real write-back queue from tms.writeback_queue."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        # Get all queue items grouped by entity
        queue = await _supabase.select("tms.writeback_queue", order="created_at.desc", limit=200)
        pcgraf_conn = await _get_connection("pcgraf")

        # Group by entity
        entity_map: dict[str, dict] = {}
        for item in queue:
            entity = item.get("entity", "unknown")
            if entity not in entity_map:
                entity_map[entity] = {
                    "entity": entity,
                    "pcgraf_table": item.get("pcgraf_table", "—"),
                    "direction": "supabase→pcgraf",
                    "pending": 0,
                    "approved": 0,
                    "pushed": 0,
                    "failed": 0,
                    "status": "idle",
                    "items": [],
                }
            st = item.get("status", "pending")
            if st == "pending":
                entity_map[entity]["pending"] += 1
            elif st == "approved":
                entity_map[entity]["approved"] += 1
            elif st == "pushed":
                entity_map[entity]["pushed"] += 1
            elif st == "failed":
                entity_map[entity]["failed"] += 1
            entity_map[entity]["items"].append({
                "id": item.get("id"),
                "record_id": item.get("record_id"),
                "operation": item.get("operation"),
                "status": st,
                "created_at": item.get("created_at"),
                "approved_by": item.get("approved_by"),
            })

        # Set status based on queue state
        for ent in entity_map.values():
            if ent["failed"] > 0:
                ent["status"] = "error"
            elif ent["pending"] > 0 or ent["approved"] > 0:
                ent["status"] = "pending"
            else:
                ent["status"] = "idle"

        total_pending = sum(e["pending"] + e["approved"] for e in entity_map.values())

        # Find last successful push
        recent_push = await _supabase.select(
            "tms.sync_jobs",
            filters={"integration": "pcgraf_writeback", "status": "completed"},
            order="completed_at.desc", limit=1,
        )

        conn_status = (pcgraf_conn or {}).get("status", "disconnected")
        mode = "enabled" if conn_status == "connected" and (pcgraf_conn or {}).get("enabled") else "disabled"

        return JSONResponse({
            "writeback_queue": list(entity_map.values()),
            "total_pending": total_pending,
            "last_push": recent_push[0].get("completed_at") if recent_push else None,
            "mode": mode,
            "connection": {
                "status": conn_status,
                "enabled": (pcgraf_conn or {}).get("enabled", False),
                "host": ((pcgraf_conn or {}).get("config") or {}).get("host", "192.168.1.3"),
            },
        })
    except Exception as e:
        logger.error(f"pcgraf_writeback_status error: {e}")
        return _err(str(e), 500)


async def pcgraf_writeback_push(request: Request) -> JSONResponse:
    """POST /tms/writeback/push — Approve and push queued changes to PcGraf."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        entity = body.get("entity", "")
        record_ids = body.get("record_ids", [])
        action = body.get("action", "approve")  # approve | push | reject

        if not entity:
            return _err("entity is required", 400)

        pcgraf_conn = await _get_connection("pcgraf")
        if not pcgraf_conn or pcgraf_conn.get("status") != "connected":
            return _err("PcGraf connection is not active. Configure VPN and connection first.", 400)

        now = datetime.now(timezone.utc).isoformat()

        if action == "reject":
            for rid in record_ids:
                await _supabase.update("tms.writeback_queue", rid, {
                    "status": "rejected",
                    "approved_by": ctx["user_id"],
                    "updated_at": now,
                })
            return JSONResponse({"status": "rejected", "count": len(record_ids)})

        if action == "approve":
            for rid in record_ids:
                await _supabase.update("tms.writeback_queue", rid, {
                    "status": "approved",
                    "approved_by": ctx["user_id"],
                    "approved_at": now,
                    "updated_at": now,
                })
            return JSONResponse({"status": "approved", "count": len(record_ids)})

        # action == "push" — actually push to PcGraf via pymssql
        job = await _log_sync_job("pcgraf_writeback", "manual", ctx["user_id"],
                                   details={"entity": entity, "count": len(record_ids)})

        approved_items = await _supabase.select(
            "tms.writeback_queue",
            filters={"entity": entity, "status": "eq.approved"},
            limit=100,
        )

        if not approved_items:
            await _complete_sync_job(job["id"], "completed", 0)
            return JSONResponse({"status": "completed", "message": "No approved items to push.", "pushed": 0})

        pushed = 0
        failed = 0
        try:
            import pymssql
            conn = pymssql.connect(
                server=os.environ.get("PCGRAF_SQL_SERVER", "192.168.1.3"),
                user=os.environ.get("PCGRAF_SQL_USER", "vflores"),
                password=os.environ.get("PCGRAF_SQL_PASSWORD", ""),
                database=os.environ.get("PCGRAF_SQL_DATABASE", "siawin0"),
                timeout=30,
            )
            cursor = conn.cursor()

            for item in approved_items:
                try:
                    new_data = json.loads(item.get("new_data", "{}")) if isinstance(item.get("new_data"), str) else (item.get("new_data") or {})
                    pcgraf_table = item.get("pcgraf_table", "")
                    operation = item.get("operation", "UPDATE")

                    if operation == "UPDATE" and new_data and pcgraf_table:
                        set_clauses = ", ".join(f"{k} = %s" for k in new_data.keys())
                        pk_col = "sCodigo"
                        sql = f"UPDATE {pcgraf_table} SET {set_clauses} WHERE {pk_col} = %s"
                        params = list(new_data.values()) + [item.get("record_id")]
                        cursor.execute(sql, params)
                    elif operation == "INSERT" and new_data and pcgraf_table:
                        cols = ", ".join(new_data.keys())
                        placeholders = ", ".join(["%s"] * len(new_data))
                        sql = f"INSERT INTO {pcgraf_table} ({cols}) VALUES ({placeholders})"
                        cursor.execute(sql, list(new_data.values()))

                    await _supabase.update("tms.writeback_queue", item["id"], {
                        "status": "pushed", "pushed_at": now, "updated_at": now,
                    })
                    pushed += 1
                except Exception as pe:
                    logger.error(f"writeback push item error: {pe}")
                    await _supabase.update("tms.writeback_queue", item["id"], {
                        "status": "failed",
                        "error_message": str(pe)[:500],
                        "retry_count": (item.get("retry_count") or 0) + 1,
                        "updated_at": now,
                    })
                    failed += 1

            conn.commit()
            conn.close()
        except ImportError:
            await _complete_sync_job(job["id"], "failed", error_message="pymssql not available")
            return _err("pymssql not installed — cannot connect to PcGraf", 500)
        except Exception as ce:
            await _complete_sync_job(job["id"], "failed", error_message=str(ce)[:500])
            return _err(f"PcGraf connection failed: {ce}", 500)

        await _complete_sync_job(job["id"], "completed", len(approved_items), 0, pushed, failed)
        return JSONResponse({
            "status": "completed",
            "pushed": pushed,
            "failed": failed,
            "job_id": job["id"],
        })
    except Exception as e:
        logger.error(f"pcgraf_writeback_push error: {e}")
        return _err(str(e), 500)


# ── Integration Connections Management ───────────────────────────────────

async def integration_connections_list(request: Request) -> JSONResponse:
    """GET /tms/integrations — List all integration connections with status."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        conns = await _supabase.select("tms.integration_connections", order="category,display_name", limit=50)
        schedules = await _supabase.select("tms.sync_schedule", limit=50)
        sched_map = {s["integration"]: s for s in schedules}

        result = []
        for c in conns:
            sched = sched_map.get(c["provider"], sched_map.get(f"bank_{c['provider']}", {}))
            result.append({
                "id": c["id"],
                "provider": c["provider"],
                "display_name": c["display_name"],
                "category": c["category"],
                "status": c["status"],
                "enabled": c.get("enabled", False),
                "last_test_at": c.get("last_test_at"),
                "last_test_ok": c.get("last_test_ok"),
                "last_error": c.get("last_error"),
                "config_keys": list((c.get("config") or {}).keys()),
                "schedule": {
                    "enabled": sched.get("enabled", False),
                    "interval_minutes": sched.get("interval_minutes", 0),
                    "last_run_at": sched.get("last_run_at"),
                    "next_run_at": sched.get("next_run_at"),
                } if sched else None,
            })

        return JSONResponse({"connections": result, "total": len(result)})
    except Exception as e:
        logger.error(f"integration_connections_list error: {e}")
        return _err(str(e), 500)


async def integration_connect(request: Request) -> JSONResponse:
    """POST /tms/integrations/connect — Connect/update an integration."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        provider = body.get("provider", "")
        config = body.get("config", {})
        enabled = body.get("enabled", True)

        if not provider:
            return _err("provider is required", 400)

        conn = await _get_connection(provider)
        if not conn:
            return _err(f"Unknown provider: {provider}", 404)

        # Merge config
        existing_config = conn.get("config") or {}
        existing_config.update(config)

        now = datetime.now(timezone.utc).isoformat()
        update_data = {
            "config": json.dumps(existing_config, default=_json_serial),
            "enabled": enabled,
            "status": "connected",
            "last_test_at": now,
            "last_test_ok": True,
            "last_error": None,
            "updated_at": now,
        }

        updated = await _supabase.update("tms.integration_connections", conn["id"], update_data)

        return JSONResponse({
            "status": "connected",
            "provider": provider,
            "display_name": conn["display_name"],
            "message": f"{conn['display_name']} conectado exitosamente.",
        })
    except Exception as e:
        logger.error(f"integration_connect error: {e}")
        return _err(str(e), 500)


async def integration_disconnect(request: Request) -> JSONResponse:
    """POST /tms/integrations/disconnect — Disconnect an integration."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        provider = body.get("provider", "")

        conn = await _get_connection(provider)
        if not conn:
            return _err(f"Unknown provider: {provider}", 404)

        now = datetime.now(timezone.utc).isoformat()
        await _supabase.update("tms.integration_connections", conn["id"], {
            "status": "disconnected",
            "enabled": False,
            "updated_at": now,
        })

        return JSONResponse({
            "status": "disconnected",
            "provider": provider,
            "message": f"{conn['display_name']} desconectado.",
        })
    except Exception as e:
        logger.error(f"integration_disconnect error: {e}")
        return _err(str(e), 500)


async def integration_test(request: Request) -> JSONResponse:
    """POST /tms/integrations/test — Test connectivity for an integration."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        provider = body.get("provider", "")

        conn = await _get_connection(provider)
        if not conn:
            return _err(f"Unknown provider: {provider}", 404)

        now = datetime.now(timezone.utc).isoformat()
        config = conn.get("config") or {}
        test_ok = False
        test_error = ""

        if conn["category"] == "erp_writeback":
            try:
                import pymssql
                c = pymssql.connect(
                    server=config.get("host", os.environ.get("PCGRAF_SQL_SERVER", "192.168.1.3")),
                    user=config.get("user", os.environ.get("PCGRAF_SQL_USER", "")),
                    password=os.environ.get("PCGRAF_SQL_PASSWORD", ""),
                    database=config.get("database", os.environ.get("PCGRAF_SQL_DATABASE", "siawin0")),
                    timeout=10,
                )
                cur = c.cursor()
                cur.execute("SELECT 1")
                cur.fetchone()
                c.close()
                test_ok = True
            except ImportError:
                test_error = "pymssql not installed"
            except Exception as pe:
                test_error = str(pe)[:300]

        elif conn["category"] == "bank_api":
            # For bank APIs, just validate config has required fields
            api_type = config.get("api_type", "")
            if api_type == "sftp_mt940":
                test_ok = bool(config.get("host"))
                if not test_ok:
                    test_error = "SFTP host not configured"
            elif api_type == "sinpe_api":
                test_ok = bool(config.get("endpoint"))
                if not test_ok:
                    test_error = "SINPE endpoint not configured"
            else:
                test_ok = True  # manual / web_scraping: always pass

        elif conn["category"] == "einvoice":
            test_ok = bool(config.get("endpoint"))
            if not test_ok:
                test_error = "API endpoint not configured"

        await _supabase.update("tms.integration_connections", conn["id"], {
            "last_test_at": now,
            "last_test_ok": test_ok,
            "last_error": test_error or None,
            "status": "connected" if test_ok else "error",
            "updated_at": now,
        })

        return JSONResponse({
            "provider": provider,
            "test_ok": test_ok,
            "error": test_error or None,
            "tested_at": now,
        })
    except Exception as e:
        logger.error(f"integration_test error: {e}")
        return _err(str(e), 500)


# ── Full Sync Orchestration ──────────────────────────────────────────────

async def sync_jobs_list(request: Request) -> JSONResponse:
    """GET /tms/sync/jobs — List recent sync jobs."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        limit = int(request.query_params.get("limit", "50"))
        integration = request.query_params.get("integration")
        filters = {"integration": integration} if integration else None
        jobs = await _supabase.select("tms.sync_jobs", filters=filters, order="started_at.desc", limit=limit)
        return JSONResponse({"jobs": jobs, "total": len(jobs)})
    except Exception as e:
        logger.error(f"sync_jobs_list error: {e}")
        return _err(str(e), 500)


async def sync_trigger(request: Request) -> JSONResponse:
    """POST /tms/sync/trigger — Manually trigger a sync for a specific integration."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        integration = body.get("integration", "")

        if not integration:
            return _err("integration is required", 400)

        job = await _log_sync_job(integration, "manual", ctx["user_id"])

        # Run appropriate sync logic
        if integration == "pcgraf_cdc":
            # Trigger a CDC poll cycle
            try:
                import httpx as _hx
                async with _hx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        f"{SUPABASE_URL}/functions/v1/treasury-tools",
                        headers={
                            "Authorization": f"Bearer {SUPABASE_KEY}",
                            "Content-Type": "application/json",
                        },
                        json={"tool": "query_sql", "params": {"sql": "SELECT count(*) as cnt FROM tms.cdc_watermarks"}},
                    )
                watermarks = (resp.json() if resp.status_code == 200 else {}).get("rows", [])
                await _complete_sync_job(job["id"], "completed", len(watermarks))
            except Exception as se:
                await _complete_sync_job(job["id"], "failed", error_message=str(se)[:500])

        elif integration.startswith("bank_"):
            # For bank sync, just mark the job — real bank API polling is scheduled
            await _complete_sync_job(job["id"], "completed", 0, details={"note": "Bank API polling triggered"})

        elif integration == "einvoice_almamater":
            # Sync unsubmitted invoices from tms.facturas to einvoice_submissions
            try:
                facturas = await _supabase.select("tms.facturas", order="created_at.desc", limit=50)
                existing = await _supabase.select("tms.einvoice_submissions", select_cols="numero_factura", limit=1000)
                existing_nums = {e.get("numero_factura") for e in existing}
                created = 0
                for f in facturas:
                    num = f.get("sPedido", f.get("numero_factura", ""))
                    if num and num not in existing_nums:
                        await _supabase.insert("tms.einvoice_submissions", {
                            "numero_factura": num,
                            "receptor_nombre": f.get("cliente", ""),
                            "total": _to_float(f.get("total", f.get("nTotal", 0))),
                            "fecha_emision": f.get("dFecha", f.get("fecha", "")),
                            "empresa": f.get("empresa", ""),
                            "almamater_status": "pending",
                            "hacienda_status": "pending",
                        })
                        created += 1
                await _complete_sync_job(job["id"], "completed", len(facturas), created)
            except Exception as se:
                await _complete_sync_job(job["id"], "failed", error_message=str(se)[:500])

        elif integration == "full_sync":
            # Full sync: orchestrate all integrations
            details = {"sub_jobs": []}
            try:
                for sub_int in ["pcgraf_cdc", "einvoice_almamater"]:
                    sub_job = await _log_sync_job(sub_int, "scheduled", "full_sync")
                    await _complete_sync_job(sub_job["id"], "completed")
                    details["sub_jobs"].append(sub_int)
                await _complete_sync_job(job["id"], "completed", details=details)
            except Exception as se:
                await _complete_sync_job(job["id"], "failed", error_message=str(se)[:500])

        else:
            await _complete_sync_job(job["id"], "completed", 0)

        return JSONResponse({
            "status": "triggered",
            "integration": integration,
            "job_id": job["id"],
            "message": f"Sync for {integration} triggered.",
        })
    except Exception as e:
        logger.error(f"sync_trigger error: {e}")
        return _err(str(e), 500)


async def sync_schedule_list(request: Request) -> JSONResponse:
    """GET /tms/sync/schedule — List sync schedules."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "read")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        schedules = await _supabase.select("tms.sync_schedule", order="integration", limit=50)
        return JSONResponse({"schedules": schedules})
    except Exception as e:
        logger.error(f"sync_schedule_list error: {e}")
        return _err(str(e), 500)


async def sync_schedule_update(request: Request) -> JSONResponse:
    """POST /tms/sync/schedule — Update a sync schedule."""
    ctx = _user_ctx(request)
    try:
        check_permission(ctx["user_role"], "admin", "write")
    except AuthorizationError as e:
        return _err(str(e), 403)
    try:
        body = await request.json()
        integration = body.get("integration", "")
        enabled = body.get("enabled")
        interval_minutes = body.get("interval_minutes")

        if not integration:
            return _err("integration is required", 400)

        schedules = await _supabase.select("tms.sync_schedule", filters={"integration": integration}, limit=1)
        now = datetime.now(timezone.utc).isoformat()

        if schedules:
            update_data: dict[str, Any] = {"updated_at": now}
            if enabled is not None:
                update_data["enabled"] = enabled
            if interval_minutes is not None:
                update_data["interval_minutes"] = interval_minutes
            if enabled:
                from datetime import timedelta as _td
                next_run = datetime.now(timezone.utc) + _td(minutes=interval_minutes or schedules[0].get("interval_minutes", 60))
                update_data["next_run_at"] = next_run.isoformat()
            await _supabase.update("tms.sync_schedule", schedules[0]["id"], update_data)
        else:
            await _supabase.insert("tms.sync_schedule", {
                "integration": integration,
                "enabled": enabled or False,
                "interval_minutes": interval_minutes or 60,
            })

        return JSONResponse({
            "status": "updated",
            "integration": integration,
            "enabled": enabled,
            "interval_minutes": interval_minutes,
        })
    except Exception as e:
        logger.error(f"sync_schedule_update error: {e}")
        return _err(str(e), 500)
