"""Classify siawin0 tables by ERP module and show only tables with >0 rows."""
import json

d = json.load(open("siawin0_schema.json", "r", encoding="utf-8"))

# Only tables with data
active = {k: v for k, v in d.items() if v["row_count"] > 0}

# Classify by prefix
modules = {}
for tbl, info in sorted(active.items()):
    prefix = ""
    for p in ["IN", "FA", "CP", "CC", "CO", "BA", "AN", "GE", "RH", "RT", "TA", "SI", "SV", "TP", "DBT", "FE", "FW", "WB", "PI", "PK", "RC", "TS", "TM", "VO", "VF"]:
        if tbl.upper().startswith(p):
            prefix = p
            break
    if not prefix:
        prefix = "OTHER"
    if prefix not in modules:
        modules[prefix] = []
    pk = [c["name"] for c in info["columns"] if c["is_pk"]]
    modules[prefix].append({
        "table": tbl,
        "rows": info["row_count"],
        "cols": len(info["columns"]),
        "pk": pk,
        "col_names": [c["name"] for c in info["columns"]],
    })

MODULE_NAMES = {
    "IN": "Inventario / Productos",
    "FA": "Facturación / Ventas",
    "CP": "Compras / Cuentas por Pagar",
    "CC": "Cuentas por Cobrar",
    "CO": "Contabilidad",
    "BA": "Bancos / Tesorería",
    "AN": "Activos / Notas / CRM",
    "GE": "General / Catálogos",
    "RH": "Recursos Humanos",
    "RT": "Rutas / Ventas Campo",
    "TA": "Taller / Mantenimiento",
    "SI": "Sistema / Seguridad",
    "DBT": "Auditoría / Log",
    "FE": "Factura Electrónica",
    "FW": "Workflow",
    "OTHER": "Otros / Sin clasificar",
}

for mod, tables in sorted(modules.items(), key=lambda x: -sum(t["rows"] for t in x[1])):
    total_rows = sum(t["rows"] for t in tables)
    mod_name = MODULE_NAMES.get(mod, mod)
    print(f"\n{'='*80}")
    print(f"  {mod} - {mod_name}  ({len(tables)} tables, {total_rows:,} total rows)")
    print(f"{'='*80}")
    for t in sorted(tables, key=lambda x: -x["rows"]):
        pk_str = ",".join(t["pk"]) if t["pk"] else "none"
        print(f"  {t['table']:30s} {t['rows']:>12,} rows  {t['cols']:>3} cols  PK=[{pk_str}]")
