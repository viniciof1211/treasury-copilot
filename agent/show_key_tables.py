"""Show detailed columns for the most important ERP tables to design the TMS data model."""
import json

d = json.load(open("siawin0_schema.json", "r", encoding="utf-8"))

# Key ERP tables by module prefix:
# IN = Inventario, FA = Facturación, CP = Compras, CC = Cuentas por Cobrar,
# CO = Contabilidad, BA = Bancos, AN = Activos, GE = General, DBT = Audit/Log
# RH = Recursos Humanos, RT = Rutas/Ventas, TA = Taller/Mantenimiento

key_tables = [
    "IN04",   # Productos/Artículos master (213 cols!)
    "IN11",   # Movimientos de inventario
    "IN13",   # Proveedores?
    "IN14",   # Inventario por bodega
    "IN16",   # Kardex / movimientos detalle
    "IN34",   # Transacciones inventario (40M rows!)
    "IN42",   # Ordenes de compra?
    "IN51",   # Lotes?
    "FA01",   # Líneas de factura
    "FA12",   # Facturas cabecera?
    "FA20",   # Clientes?
    "FA50",   # Notas de crédito?
    "CP10",   # Ordenes de compra cabecera
    "CP11",   # Ordenes de compra detalle
    "CP12",   # Recepciones de compra?
    "CP21",   # Cuentas por pagar
    "CP31",   # Pagos?
    "CO00",   # Plan de cuentas
    "CO03",   # Asientos contables
    "CO21",   # Movimientos contables
    "CC10",   # Cuentas por cobrar
    "CC12",   # Cobros?
    "BA10",   # Movimientos bancarios
    "GE01",   # Catálogo general / empresas?
    "AN03",   # Activos fijos
]

for tbl_name in key_tables:
    if tbl_name not in d:
        print(f"\n--- {tbl_name}: NOT FOUND ---")
        continue
    info = d[tbl_name]
    pk = [c["name"] for c in info["columns"] if c["is_pk"]]
    rc = info["row_count"]
    nc = len(info["columns"])
    print(f"\n{'='*80}")
    print(f"  {tbl_name}  ({rc:,} rows, {nc} cols)  PK={pk}")
    print(f"{'='*80}")
    for c in info["columns"]:
        ml = f"({c['max_length']})" if c.get("max_length") else ""
        pkflag = " [PK]" if c["is_pk"] else ""
        print(f"  {c['name']:40s} {c['type']:15s} {ml:8s} {pkflag}")
    if info.get("sample") and len(info["sample"]) > 0:
        s = info["sample"][0]
        print(f"  --- Sample row ---")
        for k, v in list(s.items())[:15]:
            print(f"    {k:40s} = {repr(v)[:80]}")
        if len(s) > 15:
            print(f"    ... +{len(s)-15} more fields")
