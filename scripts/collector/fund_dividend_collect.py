from __future__ import annotations

import datetime as dt
import os

from collector_common import (
    clean_text,
    date_iso,
    parse_date,
    to_float,
    upsert_fund,
    upsert_fund_dividend,
)


def collect_fund_dividends(conn, seed: bool = False) -> int:
    if seed:
        return 0

    try:
        import akshare as ak
    except ImportError:
        return 0

    total = collect_cash_dividends(conn, ak)
    conn.commit()
    if os.getenv("FUND_DIVIDEND_RANK", "0") == "1":
        total += collect_dividend_rank(conn, ak)
        conn.commit()
    total += collect_etf_dividends(conn, ak)
    conn.commit()
    return total


def collect_cash_dividends(conn, ak) -> int:
    years = os.getenv("FUND_DIVIDEND_YEARS")
    if years:
        year_list = [item.strip() for item in years.split(",") if item.strip()]
    else:
        current = dt.date.today().year
        year_list = [str(current - offset) for offset in range(0, 3)]

    rows = 0
    for year in year_list:
        frames = []
        if os.getenv("FUND_DIVIDEND_FULL", "0") == "1":
            try:
                frames.append(ak.fund_fh_em(year=year, rank="DJR", sort="desc"))
            except Exception:
                continue
        else:
            page_limit = int(os.getenv("FUND_DIVIDEND_PAGES_PER_YEAR", "8"))
            for page in range(1, page_limit + 1):
                try:
                    frames.append(ak.fund_fh_em(year=year, rank="DJR", sort="desc", page=page))
                except Exception:
                    break
        if not frames:
            continue
        try:
            import pandas as pd
            df = pd.concat(frames, ignore_index=True).drop_duplicates()
        except Exception:
            df = frames[0]
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            code = clean_text(row.get("基金代码"))
            name = clean_text(row.get("基金简称"))
            registration = parse_date(row.get("权益登记日"))
            ex_date = parse_date(row.get("除息日期"))
            payment = parse_date(row.get("分红发放日"))
            dividend_per_share = to_float(row.get("分红"))
            if not code:
                continue
            if name:
                upsert_fund(conn, code=code, name=name, source="akshare")
            event_key = "|".join(
                [
                    date_iso(registration) if registration else "",
                    date_iso(ex_date) if ex_date else "",
                    date_iso(payment) if payment else "",
                    str(dividend_per_share if dividend_per_share is not None else ""),
                ]
            )
            upsert_fund_dividend(
                conn,
                fund_code=code,
                fund_name=name,
                event_key=event_key or f"cash-{year}",
                dividend_type="cash",
                registration_date=date_iso(registration) if registration else None,
                ex_dividend_date=date_iso(ex_date) if ex_date else None,
                payment_date=date_iso(payment) if payment else None,
                dividend_per_share=dividend_per_share,
                dividend_per10=dividend_per_share * 10 if dividend_per_share is not None else None,
                announcement_title=f"{name or code} 分红配送",
                source="akshare-fund-fh",
            )
            rows += 1
    return rows


def collect_dividend_rank(conn, ak) -> int:
    try:
        df = ak.fund_fh_rank_em()
    except Exception:
        return 0
    if df is None or df.empty:
        return 0

    rows = 0
    for _, row in df.iterrows():
        code = clean_text(row.get("基金代码"))
        name = clean_text(row.get("基金简称"))
        if not code:
            continue
        if name:
            upsert_fund(conn, code=code, name=name, source="akshare")
        upsert_fund_dividend(
            conn,
            fund_code=code,
            fund_name=name,
            event_key="rank-total",
            dividend_type="rank_total",
            cumulative_dividend=to_float(row.get("累计分红")),
            cumulative_count=int(to_float(row.get("累计次数")) or 0) or None,
            source="akshare-fund-fh-rank",
        )
        rows += 1
    return rows


def collect_etf_dividends(conn, ak) -> int:
    limit = int(os.getenv("ETF_DIVIDEND_LIMIT", "120"))
    codes = [
        row["fundCode"]
        for row in conn.execute(
            """
            SELECT DISTINCT fundCode
            FROM FundExchangeQuote
            WHERE exchangeType = 'ETF'
            ORDER BY totalMarketValue DESC NULLS LAST, fundCode ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    ]

    rows = 0
    for code in codes:
        symbol = etf_symbol(code)
        try:
            df = ak.fund_etf_dividend_sina(symbol=symbol)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        fund_name = conn.execute("SELECT name FROM Fund WHERE code = ?", (code,)).fetchone()
        name = fund_name["name"] if fund_name else code
        for _, row in df.iterrows():
            dividend_date = parse_date(row.get("日期"))
            cumulative = to_float(row.get("累计分红"))
            if not dividend_date:
                continue
            upsert_fund_dividend(
                conn,
                fund_code=code,
                fund_name=name,
                event_key=f"etf-{date_iso(dividend_date)}",
                dividend_type="etf_cumulative",
                payment_date=date_iso(dividend_date),
                cumulative_dividend=cumulative,
                source="akshare-etf-dividend-sina",
            )
            rows += 1
    return rows


def etf_symbol(code: str) -> str:
    if code.startswith(("15", "16", "18")):
        return f"sz{code}"
    return f"sh{code}"
