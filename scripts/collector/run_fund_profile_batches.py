from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

from collector_common import (
    ROOT_DIR,
    connect,
    create_sync_job,
    ensure_schema_exists,
    finish_sync_job,
    update_sync_job_message,
    utc_now,
)


DATA_DIR = ROOT_DIR / "data"
OUT_LOG = DATA_DIR / "fund_profile_batches.out.log"
ERR_LOG = DATA_DIR / "fund_profile_batches.err.log"


def chunked(values: list[str], size: int) -> list[list[str]]:
    if size <= 0:
        raise ValueError("batch size must be greater than 0")
    return [values[index : index + size] for index in range(0, len(values), size)]


def profile_count(conn) -> int:
    return int(conn.execute("SELECT COUNT(DISTINCT fundCode) AS value FROM FundProfile").fetchone()["value"] or 0)


def missing_profile_codes(conn) -> list[str]:
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


def all_fund_codes(conn) -> list[str]:
    rows = conn.execute("SELECT code FROM Fund ORDER BY code").fetchall()
    return [str(row["code"]) for row in rows if row["code"]]


def stale_running_child_jobs(conn, previous_max_id: int, message: str) -> None:
    conn.execute(
        """
        UPDATE SyncJob
        SET status = 'failed',
            finishedAt = ?,
            failedSources = 'fund_profile_batch_timeout',
            message = COALESCE(message || '; ', '') || ?
        WHERE id > ?
          AND jobType = 'data_backfill_target'
          AND status = 'running'
        """,
        (utc_now(), message, previous_max_id),
    )
    conn.commit()


def max_sync_job_id(conn) -> int:
    row = conn.execute("SELECT COALESCE(MAX(id), 0) AS value FROM SyncJob").fetchone()
    return int(row["value"] or 0)


def append_log(path: Path, text: str) -> None:
    if not text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(text)
        if not text.endswith("\n"):
            file.write("\n")


def parse_profile_rows(stdout: str) -> int:
    matches = re.findall(r"fund_profiles=(\d+)", stdout)
    if not matches:
        return 0
    return int(matches[-1])


def update_master(conn, job_id: int, messages: list[str]) -> None:
    update_sync_job_message(conn, job_id, "; ".join(messages[-16:]))


def run_batch(conn, batch: list[str], timeout_seconds: int) -> tuple[str, int, str]:
    previous_max_id = max_sync_job_id(conn)
    command = [
        sys.executable,
        "scripts/collector/run_backfill.py",
        "--skip-broad",
        "--profile-only",
        "--profile-limit",
        str(len(batch)),
    ]
    for code in batch:
        command.extend(["--fund-code", code])

    try:
        result = subprocess.run(
            command,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stale_running_child_jobs(
            conn,
            previous_max_id,
            f"timed out after {timeout_seconds}s by fund_profile_batches",
        )
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        append_log(OUT_LOG, stdout if isinstance(stdout, str) else stdout.decode("utf-8", errors="replace"))
        append_log(ERR_LOG, stderr if isinstance(stderr, str) else stderr.decode("utf-8", errors="replace"))
        return "timeout", 0, f"timeout after {timeout_seconds}s"

    append_log(OUT_LOG, result.stdout)
    append_log(ERR_LOG, result.stderr)
    if result.returncode == 0:
        return "success", parse_profile_rows(result.stdout), ""
    return "failed", parse_profile_rows(result.stdout), (result.stderr or result.stdout).strip()[-500:]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run all fund profile collection as short child-process batches")
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--batch-timeout-seconds", type=int, default=900)
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument("--max-batches", type=int, default=0, help="0 means process every queued batch")
    parser.add_argument("--refresh-existing", action="store_true", help="Process all funds instead of only missing profiles")
    args = parser.parse_args()

    conn = connect()
    ensure_schema_exists(conn)
    job_id = create_sync_job(conn, "fund_profile_batches")
    failed: list[str] = []
    total_profiles = 0
    before_profiles = profile_count(conn)
    codes = all_fund_codes(conn) if args.refresh_existing else missing_profile_codes(conn)
    batches = chunked(codes, args.batch_size)
    if args.max_batches > 0:
        batches = batches[: args.max_batches]

    messages = [
        f"before_profiles={before_profiles}",
        f"queued_funds={len(codes)}",
        f"batch_size={args.batch_size}",
        f"batches={len(batches)}",
        f"timeout_seconds={args.batch_timeout_seconds}",
    ]
    update_master(conn, job_id, messages)

    try:
        for index, batch in enumerate(batches, start=1):
            status, rows, detail = run_batch(conn, batch, args.batch_timeout_seconds)
            total_profiles += rows
            if status != "success":
                failed.append(f"batch_{index}_{status}")
            message = f"batch {index}/{len(batches)} {status} profiles={rows} total={total_profiles}"
            if detail:
                message += f" detail={detail}"
            messages.append(message)
            print(message, flush=True)
            update_master(conn, job_id, messages)
            if args.pause_seconds > 0:
                time.sleep(args.pause_seconds)

        after_profiles = profile_count(conn)
        messages.append(f"after_profiles={after_profiles}")
        update_master(conn, job_id, messages)
        status = "success" if not failed else ("partial" if total_profiles else "failed")
        finish_sync_job(
            conn,
            job_id,
            status=status,
            fund_rows=total_profiles,
            failed_sources=failed,
            message="; ".join(messages),
        )
        print(f"job_id={job_id} status={status} profiles={total_profiles}", flush=True)
        return 0 if status in {"success", "partial"} else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
