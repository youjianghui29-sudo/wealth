from __future__ import annotations

from collector_common import connect


def main() -> int:
    conn = connect()
    try:
        conn.execute("DELETE FROM Announcement WHERE source LIKE 'seed%'")
        conn.execute("DELETE FROM FundFee WHERE source = 'seed'")
        conn.execute("DELETE FROM FundIndustryAllocation WHERE source = 'seed'")
        conn.execute("DELETE FROM FundHolding WHERE source = 'seed'")
        conn.execute("DELETE FROM FundProfile WHERE source = 'seed'")
        conn.execute("DELETE FROM FundRankDaily WHERE source = 'seed'")
        conn.execute("DELETE FROM FundNavDaily WHERE source = 'seed'")
        conn.execute("DELETE FROM WealthNavDaily WHERE source = 'seed'")
        conn.execute("DELETE FROM WealthProduct WHERE source = 'seed'")
        conn.execute("DELETE FROM Fund WHERE source = 'seed'")
        conn.commit()
    finally:
        conn.close()
    print("Removed seed/demo data from SQLite database")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
