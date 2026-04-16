from __future__ import annotations

import argparse
import os
import traceback
from collections.abc import Callable

from announcement_collect import collect_announcements
from collector_common import connect, create_sync_job, ensure_schema_exists, finish_sync_job
from fund_collect import collect_funds
from fund_dividend_collect import collect_fund_dividends
from fund_extra_collect import collect_fund_extras
from fund_history_collect import collect_fund_history
from fund_profile_collect import collect_fund_profiles
from wealth_collect import collect_wealth_products


def fund_count(conn) -> int:
    row = conn.execute("SELECT COUNT(*) AS value FROM Fund").fetchone()
    return int(row["value"] or 0)


def coverage_snapshot(conn) -> str:
    rows = {
        "funds": conn.execute("SELECT COUNT(*) AS value FROM Fund").fetchone()["value"],
        "nav_funds": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundNavDaily").fetchone()["value"],
        "history_14": conn.execute(
            """
            SELECT COUNT(*) AS value
            FROM (
              SELECT fundCode
              FROM FundNavDaily
              GROUP BY fundCode
              HAVING COUNT(*) >= 14
            )
            """
        ).fetchone()["value"],
        "profiles": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundProfile").fetchone()["value"],
        "fees": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundFee").fetchone()["value"],
        "stock_holdings": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundHolding").fetchone()["value"],
        "industries": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundIndustryAllocation").fetchone()["value"],
        "announcements": conn.execute(
            "SELECT COUNT(DISTINCT fundCode) AS value FROM Announcement WHERE targetType = 'fund'"
        ).fetchone()["value"],
        "wealth": conn.execute("SELECT COUNT(*) AS value FROM WealthProduct").fetchone()["value"],
        "wealth_nav": conn.execute("SELECT COUNT(DISTINCT registerCode) AS value FROM WealthNavDaily").fetchone()["value"],
    }
    return ", ".join(f"{key}={value}" for key, value in rows.items())


def run_step(
    name: str,
    messages: list[str],
    failed: list[str],
    fn: Callable[[], int | dict[str, int]],
) -> int:
    try:
        result = fn()
        if isinstance(result, dict):
            messages.append(f"{name}=" + ",".join(f"{key}:{value}" for key, value in result.items()))
            return sum(result.values())
        messages.append(f"{name}={result}")
        return int(result or 0)
    except Exception as exc:
        failed.append(name)
        messages.append(f"{name} failed: {exc}")
        traceback.print_exc()
        return 0


def positive_or_zero(value: int | None) -> int:
    if value is None or value < 0:
        return 0
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill missing fund and wealth data in resumable batches")
    parser.add_argument("--profile-limit", type=int, default=int(os.getenv("FUND_BACKFILL_PROFILE_LIMIT", "300")))
    parser.add_argument("--history-limit", type=int, default=int(os.getenv("FUND_BACKFILL_HISTORY_LIMIT", "300")))
    parser.add_argument("--full", action="store_true", help="Try to process every fund; expected to take a long time")
    parser.add_argument("--latest-only", action="store_true", help="Only refresh latest daily data and broad market datasets")
    parser.add_argument("--profile-only", action="store_true", help="Only backfill fund profiles and portfolio details")
    parser.add_argument("--history-only", action="store_true", help="Only backfill fund NAV history")
    args = parser.parse_args()

    conn = connect()
    ensure_schema_exists(conn)
    total_funds = fund_count(conn)
    if args.full:
        args.profile_limit = total_funds
        args.history_limit = total_funds

    job_type = "data_backfill_full" if args.full else "data_backfill"
    job_id = create_sync_job(conn, job_type)
    messages = [f"before: {coverage_snapshot(conn)}"]
    failed: list[str] = []
    fund_rows = 0
    wealth_rows = 0
    announcement_rows = 0

    try:
        if not args.profile_only and not args.history_only:
            fund_rows += run_step("fund_latest", messages, failed, lambda: collect_funds(conn))
            fund_rows += run_step("fund_extras", messages, failed, lambda: collect_fund_extras(conn))
            fund_rows += run_step("fund_dividends", messages, failed, lambda: collect_fund_dividends(conn))
            wealth_rows += run_step("wealth", messages, failed, lambda: collect_wealth_products(conn))
            announcement_rows += run_step("announcements", messages, failed, lambda: collect_announcements(conn))

        if not args.latest_only and not args.profile_only:
            history_limit = positive_or_zero(args.history_limit)
            if history_limit:
                fund_rows += run_step(
                    "fund_history",
                    messages,
                    failed,
                    lambda: collect_fund_history(conn, limit=history_limit),
                )

        if not args.latest_only and not args.history_only:
            profile_limit = positive_or_zero(args.profile_limit)
            if profile_limit:
                fund_rows += run_step(
                    "fund_profiles",
                    messages,
                    failed,
                    lambda: collect_fund_profiles(conn, limit=profile_limit),
                )

        messages.append(f"after: {coverage_snapshot(conn)}")
        status = "success" if not failed else ("partial" if fund_rows or wealth_rows or announcement_rows else "failed")
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
        print(f"job_id={job_id} status={status}; " + "; ".join(messages), flush=True)
        return 0 if status in {"success", "partial"} else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
