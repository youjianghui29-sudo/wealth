from __future__ import annotations

import argparse
import traceback

from announcement_collect import collect_announcements
from collector_common import connect, create_sync_job, ensure_schema_exists, finish_sync_job
from fund_collect import collect_funds
from fund_dividend_collect import collect_fund_dividends
from fund_extra_collect import collect_fund_extras
from fund_history_collect import collect_fund_history
from fund_profile_collect import collect_fund_profiles
from wealth_collect import collect_wealth_products


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily wealth and fund data collector")
    parser.add_argument("--seed", action="store_true", help="Load deterministic demo data instead of remote sources")
    args = parser.parse_args()

    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "daily_seed" if args.seed else "daily_collect")

    failed: list[str] = []
    messages: list[str] = []
    fund_rows = 0
    wealth_rows = 0
    announcement_rows = 0

    try:
        try:
            fund_rows = collect_funds(conn, seed=args.seed)
            extra_rows = collect_fund_extras(conn, seed=args.seed)
            dividend_rows = collect_fund_dividends(conn, seed=args.seed)
            history_rows = collect_fund_history(conn, seed=args.seed)
            profile_rows = collect_fund_profiles(conn, seed=args.seed)
            extra_message = ",".join(f"{key}:{value}" for key, value in extra_rows.items())
            messages.append(f"fund={fund_rows}, fund_extras={extra_message}, fund_dividends={dividend_rows}, fund_history={history_rows}, fund_profiles={profile_rows}")
        except Exception as exc:
            failed.append("fund")
            messages.append(f"fund failed: {exc}")
            traceback.print_exc()

        try:
            wealth_rows = collect_wealth_products(conn, seed=args.seed)
            messages.append(f"wealth={wealth_rows}")
        except Exception as exc:
            failed.append("wealth")
            messages.append(f"wealth failed: {exc}")
            traceback.print_exc()

        try:
            announcement_rows = collect_announcements(conn, seed=args.seed)
            messages.append(f"announcements={announcement_rows}")
        except Exception as exc:
            failed.append("announcement")
            messages.append(f"announcement failed: {exc}")
            traceback.print_exc()

        if failed and (fund_rows or wealth_rows or announcement_rows):
            status = "partial"
        elif failed:
            status = "failed"
        else:
            status = "success"

        finish_sync_job(
            conn,
            job_id,
            status=status,
            fund_rows=fund_rows,
            wealth_rows=wealth_rows,
            announcement_rows=announcement_rows,
            failed_sources=failed,
            message="; ".join(messages),
        )
        return 0 if status in {"success", "partial"} else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
