"""Print top tables from siawin0_schema.json with columns and samples."""
import json

d = json.load(open("siawin0_schema.json", "r", encoding="utf-8"))
tables = sorted(d.items(), key=lambda x: -x[1]["row_count"])[:30]

for tbl_name, info in tables:
    pk = [c["name"] for c in info["columns"] if c["is_pk"]]
    cols = [(c["name"], c["type"], c.get("max_length", "")) for c in info["columns"][:10]]
    rc = info["row_count"]
    nc = len(info["columns"])
    print(f"\n=== {tbl_name} ({rc:,} rows, {nc} cols) PK={pk} ===")
    for c in cols:
        ml = f"({c[2]})" if c[2] else ""
        print(f"  {c[0]:35s} {c[1]:15s} {ml}")
    if nc > 10:
        print(f"  ... +{nc - 10} more columns")
    if info.get("sample"):
        s = info["sample"][0]
        keys = list(s.keys())[:6]
        vals = {k: s[k] for k in keys}
        print(f"  Sample: {vals}")
