from __future__ import annotations

import argparse
import time
import traceback

from collector_common import (
    connect,
    create_sync_job,
    ensure_schema_exists,
    finish_sync_job,
    update_sync_job_message,
)
from fund_history_collect import collect_fund_history
from fund_profile_collect import collect_fund_profiles


def chunked(values: list[str], size: int) -> list[list[str]]:
    if size <= 0:
        raise ValueError("batch size must be greater than 0")
    return [values[index : index + size] for index in range(0, len(values), size)]


def coverage_snapshot(conn) -> str:
    rows = {
        "funds": conn.execute("SELECT COUNT(*) AS value FROM Fund").fetchone()["value"],
        "nav_funds": conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundNavDaily").fetchone()["value"],
        "history_240": conn.execute(
            """
            SELECT COUNT(*) AS value
            FROM (
              SELECT fundCode
              FROM FundNavDaily
              GROUP BY fundCode
              HAVING COUNT(*) >= 240
            )
            """
        ).fetchone()["value"],
        "history_756": conn.execute(
            """
            SELECT COUNT(*) AS value
            FROM (
              SELECT fundCode
              FROM FundNavDaily
              GROUP BY fundCode
              HAVING COUNT(*) >= 756
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
    }
    return ", ".join(f"{key}={value}" for key, value in rows.items())


def all_fund_codes(conn) -> list[str]:
    rows = conn.execute("SELECT code FROM Fund ORDER BY code").fetchall()
    return [str(row["code"]) for row in rows if row["code"]]


def history_gap_codes(conn, minimum_rows: int) -> list[str]:
    rows = conn.execute(
        """
        SELECT f.code
        FROM Fund f
        LEFT JOIN FundNavDaily n ON n.fundCode = f.code
        GROUP BY f.code
        HAVING COUNT(n.id) < ?
        ORDER BY COUNT(n.id), f.code
        """,
        (minimum_rows,),
    ).fetchall()
    return [str(row["code"]) for row in rows if row["code"]]


def profile_gap_codes(conn, refresh_existing: bool) -> list[str]:
    if refresh_existing:
        return all_fund_codes(conn)
    rows = conn.execute(
        """
        SELECT f.code
        FROM Fund f
        LEFT JOIN FundProfile fp ON fp.fundCode = f.code
        WHERE fp.fundCode IS NULL
        ORDER BY f.code
        """
    ).fetchall()
    return [str(row["code"]) for row in rows if row["code"]]


def update_progress(conn, job_id: int, messages: list[str]) -> None:
    update_sync_job_message(conn, job_id, "; ".join(messages[-12:]))


def run_history_batches(conn, job_id: int, args, messages: list[str], failed: list[str]) -> int:
    if args.profile_only:
        return 0

    codes = all_fund_codes(conn) if args.history_all else history_gap_codes(conn, args.min_history_rows)
    batches = chunked(codes, args.history_batch_size)
    total_rows = 0
    messages.append(
        f"history queued funds={len(codes)}, min_rows={args.min_history_rows}, days={args.history_days}, batches={len(batches)}"
    )
    update_progress(conn, job_id, messages)

    for index, batch in enumerate(batches, start=1):
        label = f"history batch {index}/{len(batches)} size={len(batch)}"
        try:
            rows = collect_fund_history(
                conn,
                limit=len(batch),
                history_days=args.history_days,
                target_codes=batch,
                scope="priority",
            )
            total_rows += rows
            messages.append(f"{label} rows={rows} total={total_rows}")
            print(messages[-1], flush=True)
        except Exception as exc:
            conn.rollback()
            failed.append(f"history_batch_{index}")
            messages.append(f"{label} failed: {exc}")
            traceback.print_exc()
        update_progress(conn, job_id, messages)
        if args.pause_seconds > 0:
            time.sleep(args.pause_seconds)

    return total_rows


def run_profile_batches(conn, job_id: int, args, messages: list[str], failed: list[str]) -> int:
    if args.history_only:
        return 0

    codes = profile_gap_codes(conn, args.refresh_profiles)
    batches = chunked(codes, args.profile_batch_size)
    total_profiles = 0
    messages.append(
        f"profile queued funds={len(codes)}, refresh_existing={args.refresh_profiles}, batches={len(batches)}"
    )
    update_progress(conn, job_id, messages)

    for index, batch in enumerate(batches, start=1):
        label = f"profile batch {index}/{len(batches)} size={len(batch)}"
        try:
            rows = collect_fund_profiles(
                conn,
                limit=len(batch),
                target_codes=batch,
                scope="priority",
            )
            total_profiles += rows
            messages.append(f"{label} profiles={rows} total={total_profiles}")
            print(messages[-1], flush=True)
        except Exception as exc:
            conn.rollback()
            failed.append(f"profile_batch_{index}")
            messages.append(f"{label} failed: {exc}")
            traceback.print_exc()
        update_progress(conn, job_id, messages)
        if args.pause_seconds > 0:
            time.sleep(args.pause_seconds)

    return total_profiles


def main() -> int:
    parser = argparse.ArgumentParser(description="Sequential all-fund history and profile backfill")
    parser.add_argument("--history-days", type=int, default=756, help="NAV rows to keep from each fund history response")
    parser.add_argument("--min-history-rows", type=int, default=756, help="Queue funds with fewer NAV rows than this")
    parser.add_argument("--history-batch-size", type=int, default=80)
    parser.add_argument("--profile-batch-size", type=int, default=20)
    parser.add_argument("--pause-seconds", type=float, default=0.0)
    parser.add_argument("--history-only", action="store_true")
    parser.add_argument("--profile-only", action="store_true")
    parser.add_argument("--history-all", action="store_true", help="Process every fund for history, not only gaps")
    parser.add_argument("--refresh-profiles", action="store_true", help="Refresh all profiles instead of only missing profiles")
    args = parser.parse_args()

    if args.history_only and args.profile_only:
        raise ValueError("--history-only and --profile-only cannot be used together")

    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "fund_full_history_profile_backfill")
    messages = [f"before: {coverage_snapshot(conn)}"]
    failed: list[str] = []
    history_rows = 0
    profile_rows = 0
    update_progress(conn, job_id, messages)

    try:
        history_rows = run_history_batches(conn, job_id, args, messages, failed)
        messages.append(f"after history: {coverage_snapshot(conn)}")
        update_progress(conn, job_id, messages)

        profile_rows = run_profile_batches(conn, job_id, args, messages, failed)
        messages.append(f"after profile: {coverage_snapshot(conn)}")
        update_progress(conn, job_id, messages)

        status = "success" if not failed else ("partial" if history_rows or profile_rows else "failed")
        finish_sync_job(
            conn,
            job_id,
            status=status,
            fund_rows=history_rows + profile_rows,
            failed_sources=failed,
            message="; ".join(messages),
        )
        print(
            f"job_id={job_id} status={status} history_rows={history_rows} profile_rows={profile_rows}",
            flush=True,
        )
        return 0 if status in {"success", "partial"} else 1
    except Exception as exc:
        conn.rollback()
        failed.append("fund_full_history_profile_backfill")
        messages.append(f"failed: {exc}")
        traceback.print_exc()
        finish_sync_job(
            conn,
            job_id,
            status="failed",
            fund_rows=history_rows + profile_rows,
            failed_sources=failed,
            message="; ".join(messages),
        )
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
