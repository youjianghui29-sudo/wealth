from __future__ import annotations

import traceback

from collector_common import connect, create_sync_job, ensure_schema_exists, finish_sync_job
from fund_dividend_collect import collect_fund_dividends


def main() -> int:
    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "fund_dividend_collect")
    try:
        rows = collect_fund_dividends(conn)
        finish_sync_job(conn, job_id, status="success", fund_rows=rows, message=f"fund_dividends={rows}")
        print(f"fund_dividends={rows}", flush=True)
        return 0
    except Exception as exc:
        traceback.print_exc()
        finish_sync_job(conn, job_id, status="failed", failed_sources=["fund_dividend"], message=str(exc))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
