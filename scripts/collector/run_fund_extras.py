from __future__ import annotations

import traceback

from collector_common import connect, create_sync_job, ensure_schema_exists, finish_sync_job
from fund_extra_collect import collect_fund_extras


def main() -> int:
    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "fund_extra_collect")
    try:
        result = collect_fund_extras(conn)
        message = "; ".join(f"{key}={value}" for key, value in result.items())
        finish_sync_job(conn, job_id, status="success", message=message)
        print(message, flush=True)
        return 0
    except Exception as exc:
        traceback.print_exc()
        finish_sync_job(conn, job_id, status="failed", failed_sources=["fund_extra"], message=str(exc))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
