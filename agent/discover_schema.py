"""Discover PcGraf siawin0 database schema: tables, columns, types, PKs, FKs."""
import pymssql
import json
import sys

CONN = {
    "server": "192.168.1.3",
    "user": "vflores",
    "password": "9547Fl0r3$",
    "database": "siawin0",
}

def main():
    print(f"Connecting to {CONN['server']} / {CONN['database']} ...")
    conn = pymssql.connect(**CONN)
    cursor = conn.cursor(as_dict=True)

    # 1. List all user tables
    cursor.execute("""
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    """)
    tables = [r["TABLE_NAME"] for r in cursor.fetchall()]
    print(f"\n=== {len(tables)} tables found ===")
    for t in tables:
        print(f"  - {t}")

    # 2. For each table: columns, types, PKs
    schema = {}
    for tbl in tables:
        cursor.execute(f"""
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                  ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
            WHERE c.TABLE_NAME = %s
            ORDER BY c.ORDINAL_POSITION
        """, (tbl,))
        cols = cursor.fetchall()
        schema[tbl] = {
            "columns": [],
            "row_count": 0,
            "sample": [],
        }
        for col in cols:
            schema[tbl]["columns"].append({
                "name": col["COLUMN_NAME"],
                "type": col["DATA_TYPE"],
                "max_length": col["CHARACTER_MAXIMUM_LENGTH"],
                "precision": col["NUMERIC_PRECISION"],
                "scale": col["NUMERIC_SCALE"],
                "nullable": col["IS_NULLABLE"],
                "default": str(col["COLUMN_DEFAULT"]) if col["COLUMN_DEFAULT"] else None,
                "is_pk": bool(col["is_pk"]),
            })

        # Row count
        try:
            cursor.execute(f"SELECT COUNT(*) AS cnt FROM [{tbl}]")
            row = cursor.fetchone()
            schema[tbl]["row_count"] = row["cnt"] if row else 0
        except Exception:
            schema[tbl]["row_count"] = -1

        # Sample 3 rows
        try:
            cursor.execute(f"SELECT TOP 3 * FROM [{tbl}]")
            samples = cursor.fetchall()
            clean = []
            for s in samples:
                r = {}
                for k, v in s.items():
                    if isinstance(v, bytes):
                        r[k] = v.hex()[:20]
                    elif hasattr(v, 'isoformat'):
                        r[k] = v.isoformat()
                    else:
                        r[k] = v
                clean.append(r)
            schema[tbl]["sample"] = clean
        except Exception:
            schema[tbl]["sample"] = []

    # 3. Foreign keys
    cursor.execute("""
        SELECT
            fk.name AS fk_name,
            tp.name AS parent_table,
            cp.name AS parent_column,
            tr.name AS referenced_table,
            cr.name AS referenced_column
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
        JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
        JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
        JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
        ORDER BY tp.name, cp.name
    """)
    fks = cursor.fetchall()
    print(f"\n=== {len(fks)} foreign keys found ===")
    for fk in fks:
        print(f"  {fk['parent_table']}.{fk['parent_column']} -> {fk['referenced_table']}.{fk['referenced_column']}  ({fk['fk_name']})")
        # Attach to schema
        tbl = fk["parent_table"]
        if tbl in schema:
            if "foreign_keys" not in schema[tbl]:
                schema[tbl]["foreign_keys"] = []
            schema[tbl]["foreign_keys"].append({
                "fk_name": fk["fk_name"],
                "column": fk["parent_column"],
                "references_table": fk["referenced_table"],
                "references_column": fk["referenced_column"],
            })

    conn.close()

    # 4. Print summary
    print(f"\n=== Schema Summary ===")
    for tbl, info in sorted(schema.items(), key=lambda x: -x[1]["row_count"]):
        pk_cols = [c["name"] for c in info["columns"] if c["is_pk"]]
        fk_count = len(info.get("foreign_keys", []))
        print(f"  {tbl}: {info['row_count']:,} rows, {len(info['columns'])} cols, PK=[{','.join(pk_cols)}], FKs={fk_count}")

    # 5. Save full schema to JSON
    out_path = "siawin0_schema.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nFull schema saved to {out_path}")

if __name__ == "__main__":
    main()
