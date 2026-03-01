"""
TMS Engine — Data Virtualization Layer + Transaction Engine + Workflow Engine

This module is the core backend for the transactional TMS. It provides:
  1. Data Virtualization Layer (DVL) — unified CRUD over Supabase (R/W) + PcGraf (R)
  2. Transaction Engine — validation, audit logging, optimistic concurrency, soft deletes
  3. Workflow Engine — maker-checker approvals, STP rules, status transitions
  4. RBAC — per-module permission checks
"""

import os
import json
import logging
import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Any, Optional

import httpx

logger = logging.getLogger("tms_engine")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

PCGRAF_HOST = os.environ.get("PCGRAF_SQL_SERVER", "192.168.1.3")
PCGRAF_USER = os.environ.get("PCGRAF_SQL_USER", "vflores")
PCGRAF_PASS = os.environ.get("PCGRAF_SQL_PASSWORD", "")
PCGRAF_DB   = os.environ.get("PCGRAF_SQL_DATABASE", "siawin0")

# ─────────────────────────────────────────────────────────────────────────────
# Entity Registry — maps entity names to their configuration
# ─────────────────────────────────────────────────────────────────────────────

# Module permissions by role
ROLE_PERMISSIONS: dict[str, dict[str, str]] = {
    "admin":             {"cash": "rw", "cxp": "rw", "cxc": "rw", "fx": "rw", "projects": "rw", "invoicing": "rw", "recon": "rw", "debt": "rw", "mrp": "rw", "board": "rw", "ai": "rw", "admin": "rw"},
    "finance_manager":   {"cash": "rw", "cxp": "rw", "cxc": "rw", "fx": "rw", "projects": "rw", "invoicing": "rw", "recon": "rw", "debt": "rw", "mrp": "r",  "board": "rw", "ai": "rw", "admin": "r"},
    "treasury_analyst":  {"cash": "rw", "cxp": "rw", "cxc": "rw", "fx": "r",  "projects": "r",  "invoicing": "r",  "recon": "rw", "debt": "r",  "mrp": "r",  "board": "r",  "ai": "rw", "admin": ""},
    "viewer":            {"cash": "r",  "cxp": "r",  "cxc": "r",  "fx": "r",  "projects": "r",  "invoicing": "r",  "recon": "r",  "debt": "r",  "mrp": "r",  "board": "r",  "ai": "r",  "admin": ""},
}

ENTITY_CONFIG: dict[str, dict[str, Any]] = {
    # ── Project Finance ──
    "contratos":            {"table": "tms.contratos",            "module": "projects", "writable": True,  "has_version": True,  "has_soft_delete": True,  "approval_required": True},
    "hitos_contrato":       {"table": "tms.hitos_contrato",       "module": "projects", "writable": True,  "has_version": True,  "has_soft_delete": True,  "approval_required": False},
    # ── Debt ──
    "debt_instruments":     {"table": "tms.debt_instruments",     "module": "debt",     "writable": True,  "has_version": True,  "has_soft_delete": True,  "approval_required": False},
    "debt_schedules":       {"table": "tms.debt_schedules",       "module": "debt",     "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── Cash ──
    "cashflow_scenarios":   {"table": "tms.cashflow_scenarios",   "module": "cash",     "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "cashflow_forecast":    {"table": "tms.cashflow_forecast",    "module": "cash",     "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── Payments (CxP) ──
    "payment_batches":      {"table": "tms.payment_batches",      "module": "cxp",      "writable": True,  "has_version": True,  "has_soft_delete": True,   "approval_required": True},
    "payment_instructions": {"table": "tms.payment_instructions", "module": "cxp",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── Approvals ──
    "approval_workflows":   {"table": "tms.approval_workflows",   "module": "admin",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "approval_steps":       {"table": "tms.approval_steps",       "module": "admin",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── Bank Recon ──
    "bank_statements":      {"table": "tms.bank_statements",      "module": "recon",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "bank_statement_lines": {"table": "tms.bank_statement_lines", "module": "recon",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "recon_matches":        {"table": "tms.recon_matches",        "module": "recon",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── FX ──
    "fx_positions":         {"table": "tms.fx_positions",         "module": "fx",       "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "fx_hedges":            {"table": "tms.fx_hedges",            "module": "fx",       "writable": True,  "has_version": True,  "has_soft_delete": False,  "approval_required": True},
    # ── System ──
    "business_rules":       {"table": "tms.business_rules",       "module": "admin",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "audit_log":            {"table": "tms.audit_log",            "module": "admin",    "writable": False, "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "notifications":        {"table": "tms.notifications",        "module": "admin",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "report_templates":     {"table": "tms.report_templates",     "module": "admin",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    # ── Existing ERP-synced entities (read-write via Supabase, synced from PcGraf) ──
    "productos":            {"table": "tms.productos",            "module": "mrp",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "proveedores":          {"table": "tms.proveedores",          "module": "mrp",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "clientes":             {"table": "tms.clientes",             "module": "invoicing","writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "facturas":             {"table": "tms.facturas",             "module": "invoicing","writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": True},
    "lineas_factura":       {"table": "tms.lineas_factura",       "module": "invoicing","writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "ordenes_compra":       {"table": "tms.ordenes_compra",       "module": "cxp",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "cuentas_por_pagar":    {"table": "tms.cuentas_por_pagar",    "module": "cxp",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "cuentas_por_cobrar":   {"table": "tms.cuentas_por_cobrar",   "module": "cxc",      "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "movimientos_bancarios":{"table": "tms.movimientos_bancarios","module": "recon",    "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "tipos_cambio":         {"table": "tms.tipos_cambio",         "module": "fx",       "writable": True,  "has_version": False, "has_soft_delete": False,  "approval_required": False},
    "plan_cuentas":         {"table": "tms.plan_cuentas",         "module": "admin",    "writable": False, "has_version": False, "has_soft_delete": False,  "approval_required": False},
}


# ─────────────────────────────────────────────────────────────────────────────
# JSON serialization helpers
# ─────────────────────────────────────────────────────────────────────────────

def _json_serial(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    raise TypeError(f"Type {type(obj)} not serializable")


def _clean_row(row: dict) -> dict:
    """Ensure all values are JSON-serializable."""
    out = {}
    for k, v in row.items():
        if isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, uuid.UUID):
            out[k] = str(v)
        else:
            out[k] = v
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Supabase Adapter (R/W)
# ─────────────────────────────────────────────────────────────────────────────

class SupabaseAdapter:
    """Thin async HTTP adapter over Supabase PostgREST."""

    def __init__(self):
        self.base_url = SUPABASE_URL
        self.key = SUPABASE_KEY
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=f"{self.base_url}/rest/v1",
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=30.0,
            )
        return self._client

    async def select(
        self,
        table: str,
        filters: Optional[dict] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        select_cols: str = "*",
    ) -> list[dict]:
        client = await self._get_client()
        # Table name for PostgREST: strip schema prefix, use schema header
        schema, tbl = table.split(".") if "." in table else ("public", table)
        params: dict[str, Any] = {"select": select_cols, "limit": limit, "offset": offset}
        if order:
            params["order"] = order
        # Apply filters as PostgREST query params
        if filters:
            for key, value in filters.items():
                if isinstance(value, list):
                    params[key] = f"in.({','.join(str(v) for v in value)})"
                elif isinstance(value, str) and value.startswith(("eq.", "gt.", "lt.", "gte.", "lte.", "like.", "ilike.", "neq.", "is.", "in.")):
                    params[key] = value
                else:
                    params[key] = f"eq.{value}"
        headers = {}
        if schema != "public":
            headers["Accept-Profile"] = schema
            headers["Content-Profile"] = schema
        resp = await client.get(f"/{tbl}", params=params, headers=headers)
        resp.raise_for_status()
        rows = resp.json()
        return [_clean_row(r) for r in rows]

    async def select_one(self, table: str, id_value: str) -> Optional[dict]:
        rows = await self.select(table, filters={"id": id_value}, limit=1)
        return rows[0] if rows else None

    async def count(self, table: str, filters: Optional[dict] = None) -> int:
        client = await self._get_client()
        schema, tbl = table.split(".") if "." in table else ("public", table)
        params: dict[str, Any] = {"select": "id", "limit": 0}
        if filters:
            for key, value in filters.items():
                if isinstance(value, str) and value.startswith(("eq.", "gt.", "lt.", "gte.", "lte.", "neq.", "is.")):
                    params[key] = value
                else:
                    params[key] = f"eq.{value}"
        headers = {"Prefer": "count=exact"}
        if schema != "public":
            headers["Accept-Profile"] = schema
            headers["Content-Profile"] = schema
        resp = await client.get(f"/{tbl}", params=params, headers=headers)
        resp.raise_for_status()
        # Extract count from content-range header
        cr = resp.headers.get("content-range", "")
        if "/" in cr:
            total = cr.split("/")[-1]
            return int(total) if total != "*" else 0
        return len(resp.json())

    async def insert(self, table: str, data: dict) -> dict:
        client = await self._get_client()
        schema, tbl = table.split(".") if "." in table else ("public", table)
        headers = {}
        if schema != "public":
            headers["Accept-Profile"] = schema
            headers["Content-Profile"] = schema
        resp = await client.post(f"/{tbl}", json=data, headers=headers)
        resp.raise_for_status()
        rows = resp.json()
        return _clean_row(rows[0]) if rows else data

    async def update(self, table: str, id_value: str, data: dict) -> dict:
        client = await self._get_client()
        schema, tbl = table.split(".") if "." in table else ("public", table)
        headers = {}
        if schema != "public":
            headers["Accept-Profile"] = schema
            headers["Content-Profile"] = schema
        resp = await client.patch(
            f"/{tbl}",
            params={"id": f"eq.{id_value}"},
            json=data,
            headers=headers,
        )
        resp.raise_for_status()
        rows = resp.json()
        return _clean_row(rows[0]) if rows else data

    async def soft_delete(self, table: str, id_value: str, user_id: str) -> dict:
        return await self.update(table, id_value, {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })


# Singleton
_supabase = SupabaseAdapter()


# ─────────────────────────────────────────────────────────────────────────────
# RBAC — Role-Based Access Control
# ─────────────────────────────────────────────────────────────────────────────

class AuthorizationError(Exception):
    pass


def check_permission(role: str, module: str, action: str) -> None:
    """Raise AuthorizationError if role lacks permission for action on module."""
    perms = ROLE_PERMISSIONS.get(role, {})
    module_perm = perms.get(module, "")
    if action in ("read", "list"):
        if "r" not in module_perm:
            raise AuthorizationError(f"Role '{role}' has no read access to module '{module}'")
    elif action in ("create", "update", "delete", "approve", "reject"):
        if "w" not in module_perm:
            raise AuthorizationError(f"Role '{role}' has no write access to module '{module}'")


# ─────────────────────────────────────────────────────────────────────────────
# Audit Logger
# ─────────────────────────────────────────────────────────────────────────────

async def write_audit_log(
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    module: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Write an immutable audit log entry."""
    try:
        entry = {
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "user_id": user_id,
            "user_name": user_name,
            "user_role": user_role,
            "old_values": json.loads(json.dumps(old_values, default=_json_serial)) if old_values else None,
            "new_values": json.loads(json.dumps(new_values, default=_json_serial)) if new_values else None,
            "modulo": module,
            "metadata": metadata or {},
        }
        await _supabase.insert("tms.audit_log", entry)
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Notification Helper
# ─────────────────────────────────────────────────────────────────────────────

async def send_notification(
    user_id: str,
    titulo: str,
    mensaje: str,
    tipo: str = "info",
    modulo: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action_url: Optional[str] = None,
) -> None:
    try:
        await _supabase.insert("tms.notifications", {
            "user_id": user_id,
            "titulo": titulo,
            "mensaje": mensaje,
            "tipo": tipo,
            "modulo": modulo,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "action_url": action_url,
        })
    except Exception as e:
        logger.error(f"Failed to send notification: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Engine — Maker-Checker Approvals
# ─────────────────────────────────────────────────────────────────────────────

async def get_workflow_for_entity(entity_type: str) -> Optional[dict]:
    """Find active approval workflow for an entity type."""
    rows = await _supabase.select(
        "tms.approval_workflows",
        filters={"entity_type": entity_type, "es_activo": True},
        limit=1,
    )
    return rows[0] if rows else None


async def check_stp_eligible(workflow: dict, data: dict) -> bool:
    """Check if transaction qualifies for Straight-Through Processing."""
    if not workflow.get("stp_enabled"):
        return False
    max_monto = workflow.get("stp_max_monto")
    if max_monto is not None:
        txn_monto = float(data.get("monto", 0) or data.get("total_monto", 0) or data.get("monto_contrato", 0) or 0)
        if txn_monto > float(max_monto):
            return False
    return True


async def process_approval(
    workflow_id: str,
    entity_type: str,
    entity_id: str,
    action: str,
    user_id: str,
    user_name: str = "",
    user_role: str = "",
    comment: str = "",
) -> dict:
    """Process an approval/rejection step."""
    # Record the step
    step = await _supabase.insert("tms.approval_steps", {
        "workflow_id": workflow_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "paso_numero": 1,
        "accion": action,
        "comentario": comment,
        "usuario_id": user_id,
        "usuario_nombre": user_name,
        "rol": user_role,
    })

    # Determine the entity's config to find its table
    config = ENTITY_CONFIG.get(entity_type)
    if not config:
        return step

    table = config["table"]

    # Update entity status based on action
    if action == "aprobar":
        new_status = "aprobado"
        update_data: dict[str, Any] = {
            "estado": new_status,
            "updated_by": user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        # For payment_batches, also set approval fields
        if entity_type == "payment_batches":
            update_data["aprobado_por"] = user_name or user_id
            update_data["aprobado_at"] = datetime.now(timezone.utc).isoformat()
    elif action == "rechazar":
        new_status = "rechazado"
        update_data = {
            "estado": new_status,
            "updated_by": user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if entity_type == "payment_batches":
            update_data["rechazado_por"] = user_name or user_id
            update_data["rechazado_at"] = datetime.now(timezone.utc).isoformat()
            update_data["motivo_rechazo"] = comment
    elif action == "devolver":
        new_status = "borrador"
        update_data = {
            "estado": new_status,
            "updated_by": user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    else:
        return step

    await _supabase.update(table, entity_id, update_data)

    # Audit
    await write_audit_log(
        action=action.upper(),
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        new_values={"estado": new_status, "comentario": comment},
        module=config.get("module"),
        metadata={"workflow_id": workflow_id},
    )

    return step


# ─────────────────────────────────────────────────────────────────────────────
# Data Virtualization Layer — Unified CRUD
# ─────────────────────────────────────────────────────────────────────────────

class DVL:
    """Data Virtualization Layer — unified interface for all TMS entities."""

    @staticmethod
    async def list_entities() -> list[dict]:
        """Return all registered entity names and their configs."""
        return [
            {
                "entity": name,
                "table": cfg["table"],
                "module": cfg["module"],
                "writable": cfg["writable"],
                "approval_required": cfg["approval_required"],
            }
            for name, cfg in ENTITY_CONFIG.items()
        ]

    @staticmethod
    async def query(
        entity: str,
        filters: Optional[dict] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_role: str = "viewer",
    ) -> dict:
        """Query an entity with filtering, sorting, pagination."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")

        check_permission(user_role, config["module"], "read")

        table = config["table"]

        # For soft-deleted entities, exclude deleted by default
        effective_filters = dict(filters or {})
        if config.get("has_soft_delete") and "deleted_at" not in effective_filters:
            effective_filters["deleted_at"] = "is.null"

        rows = await _supabase.select(table, filters=effective_filters, order=order, limit=limit, offset=offset)
        total = await _supabase.count(table, filters=effective_filters)

        return {
            "entity": entity,
            "data": rows,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    @staticmethod
    async def get(entity: str, id_value: str, user_role: str = "viewer") -> Optional[dict]:
        """Get a single entity by ID."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")

        check_permission(user_role, config["module"], "read")
        return await _supabase.select_one(config["table"], id_value)

    @staticmethod
    async def create(
        entity: str,
        data: dict,
        user_id: str = "system",
        user_name: str = "",
        user_role: str = "admin",
    ) -> dict:
        """Create a new entity record with validation, audit, and optional approval."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")
        if not config["writable"]:
            raise ValueError(f"Entity '{entity}' is read-only")

        check_permission(user_role, config["module"], "create")

        # Inject audit fields
        now = datetime.now(timezone.utc).isoformat()
        data["created_by"] = user_id
        data["created_at"] = now
        data["updated_by"] = user_id
        data["updated_at"] = now

        # Check if approval workflow applies
        if config.get("approval_required"):
            workflow = await get_workflow_for_entity(entity)
            if workflow:
                is_stp = await check_stp_eligible(workflow, data)
                if is_stp:
                    data["estado"] = "aprobado"
                elif "estado" not in data or data.get("estado") in (None, ""):
                    data["estado"] = "pendiente_aprobacion"

        # Remove None values and generated columns
        clean_data = {k: v for k, v in data.items() if v is not None}
        # Remove GENERATED ALWAYS AS columns (they can't be inserted)
        generated_cols = _get_generated_columns(entity)
        for col in generated_cols:
            clean_data.pop(col, None)

        result = await _supabase.insert(config["table"], clean_data)

        # Audit log
        await write_audit_log(
            action="CREATE",
            entity_type=entity,
            entity_id=result.get("id"),
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            new_values=result,
            module=config["module"],
        )

        return result

    @staticmethod
    async def update(
        entity: str,
        id_value: str,
        data: dict,
        user_id: str = "system",
        user_name: str = "",
        user_role: str = "admin",
    ) -> dict:
        """Update an entity with optimistic concurrency and audit."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")
        if not config["writable"]:
            raise ValueError(f"Entity '{entity}' is read-only")

        check_permission(user_role, config["module"], "update")

        # Fetch current for audit diff and optimistic concurrency
        current = await _supabase.select_one(config["table"], id_value)
        if not current:
            raise ValueError(f"{entity} with id '{id_value}' not found")

        # Optimistic concurrency check
        if config.get("has_version"):
            expected_version = data.pop("version", None)
            if expected_version is not None and current.get("version") != expected_version:
                raise ValueError(
                    f"Optimistic concurrency conflict: expected version {expected_version}, "
                    f"found {current.get('version')}"
                )
            data["version"] = (current.get("version") or 0) + 1

        # Inject audit fields
        now = datetime.now(timezone.utc).isoformat()
        data["updated_by"] = user_id
        data["updated_at"] = now

        # Remove generated columns
        generated_cols = _get_generated_columns(entity)
        for col in generated_cols:
            data.pop(col, None)

        result = await _supabase.update(config["table"], id_value, data)

        # Audit log
        await write_audit_log(
            action="UPDATE",
            entity_type=entity,
            entity_id=id_value,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            old_values=current,
            new_values=result,
            module=config["module"],
        )

        return result

    @staticmethod
    async def delete(
        entity: str,
        id_value: str,
        user_id: str = "system",
        user_name: str = "",
        user_role: str = "admin",
    ) -> dict:
        """Soft-delete or hard-delete an entity."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")
        if not config["writable"]:
            raise ValueError(f"Entity '{entity}' is read-only")

        check_permission(user_role, config["module"], "delete")

        current = await _supabase.select_one(config["table"], id_value)
        if not current:
            raise ValueError(f"{entity} with id '{id_value}' not found")

        if config.get("has_soft_delete"):
            result = await _supabase.soft_delete(config["table"], id_value, user_id)
        else:
            # For entities without soft-delete, we still just mark updated
            result = await _supabase.update(config["table"], id_value, {
                "updated_by": user_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

        await write_audit_log(
            action="DELETE",
            entity_type=entity,
            entity_id=id_value,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            old_values=current,
            module=config["module"],
        )

        return {"deleted": True, "id": id_value, "soft": config.get("has_soft_delete", False)}

    @staticmethod
    async def approve(
        entity: str,
        id_value: str,
        action: str,
        user_id: str,
        user_name: str = "",
        user_role: str = "finance_manager",
        comment: str = "",
    ) -> dict:
        """Approve/reject/return an entity pending approval."""
        config = ENTITY_CONFIG.get(entity)
        if not config:
            raise ValueError(f"Unknown entity: {entity}")

        check_permission(user_role, config["module"], "approve")

        workflow = await get_workflow_for_entity(entity)
        if not workflow:
            raise ValueError(f"No approval workflow configured for '{entity}'")

        return await process_approval(
            workflow_id=workflow["id"],
            entity_type=entity,
            entity_id=id_value,
            action=action,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            comment=comment,
        )


def _get_generated_columns(entity: str) -> list[str]:
    """Return list of GENERATED ALWAYS AS columns that can't be inserted/updated."""
    generated = {
        "contratos": ["monto_pendiente", "saldo"],
        "hitos_contrato": ["pendiente", "saldo"],
        "debt_schedules": ["cuota"],
        "cashflow_forecast": ["flujo_neto"],
        "fx_positions": ["exposicion_neta"],
    }
    return generated.get(entity, [])


# ─────────────────────────────────────────────────────────────────────────────
# Starlette API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

from starlette.requests import Request
from starlette.responses import JSONResponse


def _get_user_context(request: Request) -> dict:
    """Extract user context from request headers or defaults."""
    return {
        "user_id": request.headers.get("x-user-id", "anonymous"),
        "user_name": request.headers.get("x-user-name", ""),
        "user_role": request.headers.get("x-user-role", "admin"),
    }


async def tms_list_entities(request: Request) -> JSONResponse:
    """GET /tms/entities — list all registered TMS entities."""
    entities = await DVL.list_entities()
    return JSONResponse({"entities": entities})


async def tms_query(request: Request) -> JSONResponse:
    """GET /tms/{entity} — query with filters, order, pagination."""
    entity = request.path_params["entity"]
    user = _get_user_context(request)
    params = dict(request.query_params)

    # Extract pagination
    limit = int(params.pop("limit", "100"))
    offset = int(params.pop("offset", "0"))
    order = params.pop("order", None)

    # Remaining params are filters
    filters = params if params else None

    try:
        result = await DVL.query(
            entity=entity,
            filters=filters,
            order=order,
            limit=limit,
            offset=offset,
            user_role=user["user_role"],
        )
        return JSONResponse(result)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL query error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_get_one(request: Request) -> JSONResponse:
    """GET /tms/{entity}/{id} — get a single record."""
    entity = request.path_params["entity"]
    id_value = request.path_params["id"]
    user = _get_user_context(request)

    try:
        result = await DVL.get(entity, id_value, user_role=user["user_role"])
        if not result:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse(result)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL get error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_create(request: Request) -> JSONResponse:
    """POST /tms/{entity} — create a new record."""
    entity = request.path_params["entity"]
    user = _get_user_context(request)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    try:
        result = await DVL.create(
            entity=entity,
            data=body,
            user_id=user["user_id"],
            user_name=user["user_name"],
            user_role=user["user_role"],
        )
        return JSONResponse(result, status_code=201)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL create error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_update(request: Request) -> JSONResponse:
    """PUT /tms/{entity}/{id} — update a record."""
    entity = request.path_params["entity"]
    id_value = request.path_params["id"]
    user = _get_user_context(request)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    try:
        result = await DVL.update(
            entity=entity,
            id_value=id_value,
            data=body,
            user_id=user["user_id"],
            user_name=user["user_name"],
            user_role=user["user_role"],
        )
        return JSONResponse(result)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL update error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_delete(request: Request) -> JSONResponse:
    """DELETE /tms/{entity}/{id} — soft/hard delete."""
    entity = request.path_params["entity"]
    id_value = request.path_params["id"]
    user = _get_user_context(request)

    try:
        result = await DVL.delete(
            entity=entity,
            id_value=id_value,
            user_id=user["user_id"],
            user_name=user["user_name"],
            user_role=user["user_role"],
        )
        return JSONResponse(result)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL delete error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_approve(request: Request) -> JSONResponse:
    """POST /tms/{entity}/{id}/approve — approve/reject/return."""
    entity = request.path_params["entity"]
    id_value = request.path_params["id"]
    user = _get_user_context(request)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    action = body.get("action", "aprobar")
    comment = body.get("comment", "")

    try:
        result = await DVL.approve(
            entity=entity,
            id_value=id_value,
            action=action,
            user_id=user["user_id"],
            user_name=user["user_name"],
            user_role=user["user_role"],
            comment=comment,
        )
        return JSONResponse(result)
    except AuthorizationError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        logger.error(f"DVL approve error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def tms_audit_log(request: Request) -> JSONResponse:
    """GET /tms/audit — query audit log."""
    user = _get_user_context(request)
    check_permission(user["user_role"], "admin", "read")

    params = dict(request.query_params)
    limit = int(params.pop("limit", "50"))
    offset = int(params.pop("offset", "0"))
    filters = params if params else None

    rows = await _supabase.select(
        "tms.audit_log",
        filters=filters,
        order="timestamp.desc",
        limit=limit,
        offset=offset,
    )
    total = await _supabase.count("tms.audit_log", filters=filters)
    return JSONResponse({"data": rows, "total": total, "limit": limit, "offset": offset})


async def tms_notifications(request: Request) -> JSONResponse:
    """GET /tms/notifications — get user notifications."""
    user = _get_user_context(request)
    params = dict(request.query_params)
    limit = int(params.pop("limit", "20"))
    unread_only = params.pop("unread", "false").lower() == "true"

    filters: dict[str, Any] = {"user_id": user["user_id"]}
    if unread_only:
        filters["leido"] = "eq.false"

    rows = await _supabase.select(
        "tms.notifications",
        filters=filters,
        order="created_at.desc",
        limit=limit,
    )
    return JSONResponse({"data": rows})


async def tms_mark_notification_read(request: Request) -> JSONResponse:
    """PUT /tms/notifications/{id}/read — mark notification as read."""
    notif_id = request.path_params["id"]
    user = _get_user_context(request)

    result = await _supabase.update("tms.notifications", notif_id, {
        "leido": True,
        "leido_at": datetime.now(timezone.utc).isoformat(),
    })
    return JSONResponse(result)


async def tms_business_rules(request: Request) -> JSONResponse:
    """GET /tms/rules — list all business rules."""
    rows = await _supabase.select("tms.business_rules", order="rule_id.asc", limit=100)
    return JSONResponse({"data": rows})
