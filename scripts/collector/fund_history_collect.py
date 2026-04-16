from __future__ import annotations

import os

from collector_common import clean_text, date_iso, find_col, parse_date, to_float, upsert_fund_nav


def collect_fund_history(conn, seed: bool = False, limit: int | None = None) -> int:
    if seed:
        return 0

    try:
        import akshare as ak
    except ImportError:
        return 0

    limit = limit or int(os.getenv("FUND_HISTORY_LIMIT", "30"))
    rows = conn.execute(
        """
        SELECT DISTINCT f.code
        FROM Fund f
        LEFT JOIN Watchlist w ON w.targetType = 'fund' AND w.fundCode = f.code
        LEFT JOIN FundNavDaily n ON n.id = (
          SELECT id FROM FundNavDaily latest
          WHERE latest.fundCode = f.code
          ORDER BY latest.tradeDate DESC
          LIMIT 1
        )
        ORDER BY CASE WHEN w.id IS NULL THEN 1 ELSE 0 END, n.dailyGrowthRate DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    total = 0
    for item in rows:
        code = item["code"]
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        except Exception:
            continue
        if df is None or df.empty:
            continue

        columns = [str(column) for column in df.columns]
        date_col = find_col(columns, ["净值日期"]) or find_col(columns, ["日期"])
        unit_col = find_col(columns, ["单位净值"], ["累计"])
        acc_col = find_col(columns, ["累计净值"])
        growth_rate_col = find_col(columns, ["日增长率"])
        if not date_col or not unit_col:
            continue

        previous = None
        for _, row in df.tail(180).iterrows():
            parsed_date = parse_date(row[date_col])
            if not parsed_date:
                continue
            unit_nav = to_float(row[unit_col])
            daily_growth_rate = to_float(row[growth_rate_col]) if growth_rate_col else None
            daily_growth_value = None
            growth_rate_source = "source"

            if previous is not None and unit_nav is not None:
                daily_growth_value = unit_nav - previous
                if daily_growth_rate is None and previous:
                    daily_growth_rate = (unit_nav / previous - 1) * 100
                    growth_rate_source = "calculated"

            upsert_fund_nav(
                conn,
                fund_code=clean_text(code) or code,
                trade_date=date_iso(parsed_date),
                unit_nav=unit_nav,
                accumulated_nav=to_float(row[acc_col]) if acc_col else None,
                previous_unit_nav=previous,
                daily_growth_value=daily_growth_value,
                daily_growth_rate=daily_growth_rate,
                growth_rate_source=growth_rate_source,
                subscription_status=None,
                redemption_status=None,
            )
            previous = unit_nav
            total += 1
        conn.commit()

    conn.commit()
    return total
