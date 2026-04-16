from __future__ import annotations

import argparse
import traceback

from collector_common import connect, create_sync_job, ensure_schema_exists, finish_sync_job
from fund_profile_collect import collect_fund_profiles


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect fund profile, fee, holding and industry allocation data")
    parser.add_argument("--limit", type=int, default=23030)
    args = parser.parse_args()

    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "fund_profile_collect_full")
    try:
        rows = collect_fund_profiles(conn, seed=False, limit=args.limit)
        status = "success" if rows else "failed"
        finish_sync_job(conn, job_id, status=status, message=f"fund_profiles={rows}")
        print(f"fund_profiles={rows}", flush=True)
        return 0 if rows else 1
    except Exception as exc:
        traceback.print_exc()
        finish_sync_job(
            conn,
            job_id,
            status="failed",
            failed_sources=["fund_profile"],
            message=str(exc),
        )
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
