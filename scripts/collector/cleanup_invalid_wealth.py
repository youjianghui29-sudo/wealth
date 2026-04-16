from __future__ import annotations

import re

from collector_common import connect


def valid_register_code(value: str) -> bool:
    text = value.strip()
    if any(token in text for token in ('"', "'", "+", "登记编码", "prodRegCode")):
        return False
    return bool(re.fullmatch(r"[A-Z0-9]{8,32}", text))


def main() -> int:
    conn = connect()
    try:
        rows = conn.execute("SELECT registerCode FROM WealthProduct").fetchall()
        invalid = [row["registerCode"] for row in rows if not valid_register_code(row["registerCode"])]
        for code in invalid:
            conn.execute("DELETE FROM WealthProduct WHERE registerCode = ?", (code,))
        conn.commit()
    finally:
        conn.close()
    print(f"Removed {len(invalid)} invalid wealth products")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
