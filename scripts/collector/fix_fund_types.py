from __future__ import annotations

import argparse

from collector_common import connect, ensure_schema_exists, infer_fund_type


def main() -> int:
    parser = argparse.ArgumentParser(description="Infer and backfill missing Fund.fundType values")
    parser.add_argument("--limit", type=int, default=0, help="0 means no limit")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = connect()
    ensure_schema_exists(conn)
    sql = """
        SELECT f.code, f.name, f.fundType, fp.fundTypeDetail, fp.benchmark
        FROM Fund f
        LEFT JOIN FundProfile fp ON fp.fundCode = f.code
        WHERE f.fundType IS NULL OR f.fundType = '' OR f.fundType = '??' OR f.fundType = '未知'
        ORDER BY f.code
    """
    params: tuple[int, ...] = ()
    if args.limit > 0:
        sql += " LIMIT ?"
        params = (args.limit,)

    rows = conn.execute(sql, params).fetchall()
    updates: list[tuple[str, str]] = []
    for row in rows:
        fund_type = infer_fund_type(
            name=row["name"],
            code=row["code"],
            fund_type=row["fundType"],
            detail=row["fundTypeDetail"],
            benchmark=row["benchmark"],
        )
        if fund_type:
            updates.append((fund_type, row["code"]))

    if not args.dry_run:
        conn.executemany(
            """
            UPDATE Fund
            SET fundType = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE code = ?
            """,
            updates,
        )
        conn.commit()

    print(f"checked={len(rows)} inferred={len(updates)} dry_run={args.dry_run}", flush=True)
    by_type: dict[str, int] = {}
    for fund_type, _ in updates:
        by_type[fund_type] = by_type.get(fund_type, 0) + 1
    for fund_type, count in sorted(by_type.items(), key=lambda item: (-item[1], item[0])):
        print(f"{fund_type}={count}", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
