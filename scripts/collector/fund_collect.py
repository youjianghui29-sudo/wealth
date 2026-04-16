from __future__ import annotations

from collector_common import (
    clean_text,
    date_iso,
    detect_date_from_columns,
    deterministic_walk,
    find_col,
    seed_dates,
    to_float,
    upsert_fund,
    upsert_fund_nav,
    upsert_fund_rank,
)


SEED_FUNDS = [
    ("000001", "华夏成长混合", "混合型"),
    ("000011", "华夏大盘精选混合", "混合型"),
    ("110022", "易方达消费行业股票", "股票型"),
    ("161725", "招商中证白酒指数", "指数型"),
    ("003095", "中欧医疗健康混合A", "混合型"),
    ("005827", "易方达蓝筹精选混合", "混合型"),
    ("070032", "嘉实优化红利混合", "混合型"),
    ("510300", "华泰柏瑞沪深300ETF", "ETF"),
]


def collect_funds(conn, seed: bool = False) -> int:
    if seed:
        return seed_funds(conn)

    try:
        import akshare as ak
    except ImportError as exc:
        raise RuntimeError("缺少 Python 依赖 akshare，请运行 pip install -r requirements.txt") from exc

    df = ak.fund_open_fund_daily_em()
    if df is None or df.empty:
        raise RuntimeError("AKShare fund_open_fund_daily_em 返回空数据")

    columns = [str(column) for column in df.columns]
    code_col = find_col(columns, ["基金代码"]) or find_col(columns, ["代码"])
    name_col = find_col(columns, ["基金简称"]) or find_col(columns, ["基金名称"]) or find_col(columns, ["名称"])
    type_col = find_col(columns, ["基金类型"]) or find_col(columns, ["类型"])
    unit_col = find_col(columns, ["单位净值"], ["前", "累计"])
    acc_col = find_col(columns, ["累计净值"])
    prev_col = find_col(columns, ["前单位净值"]) or find_col(columns, ["前一", "单位净值"])
    growth_value_col = find_col(columns, ["日增长值"])
    growth_rate_col = find_col(columns, ["日增长率"])
    purchase_col = find_col(columns, ["申购状态"])
    redeem_col = find_col(columns, ["赎回状态"])
    trade_date = date_iso(detect_date_from_columns(columns))

    if not code_col or not name_col:
        raise RuntimeError(f"基金实时数据缺少代码或名称列，当前列：{', '.join(columns)}")

    rows = 0
    for _, row in df.iterrows():
        code = clean_text(row[code_col])
        name = clean_text(row[name_col])
        if not code or not name:
            continue

        unit_nav = to_float(row[unit_col]) if unit_col else None
        previous_unit_nav = to_float(row[prev_col]) if prev_col else None
        daily_growth_value = to_float(row[growth_value_col]) if growth_value_col else None
        daily_growth_rate = to_float(row[growth_rate_col]) if growth_rate_col else None
        growth_rate_source = "source"

        if daily_growth_rate is None and unit_nav is not None and previous_unit_nav:
            daily_growth_rate = (unit_nav / previous_unit_nav - 1) * 100
            growth_rate_source = "calculated"
        if daily_growth_value is None and unit_nav is not None and previous_unit_nav is not None:
            daily_growth_value = unit_nav - previous_unit_nav

        purchase_status = clean_text(row[purchase_col]) if purchase_col else None
        redeem_status = clean_text(row[redeem_col]) if redeem_col else None

        upsert_fund(
            conn,
            code=code,
            name=name,
            fund_type=clean_text(row[type_col]) if type_col else None,
            purchase_status=purchase_status,
            redeem_status=redeem_status,
        )
        upsert_fund_nav(
            conn,
            fund_code=code,
            trade_date=trade_date,
            unit_nav=unit_nav,
            accumulated_nav=to_float(row[acc_col]) if acc_col else None,
            previous_unit_nav=previous_unit_nav,
            daily_growth_value=daily_growth_value,
            daily_growth_rate=daily_growth_rate,
            growth_rate_source=growth_rate_source,
            subscription_status=purchase_status,
            redemption_status=redeem_status,
        )
        upsert_fund_rank(
            conn,
            fund_code=code,
            rank_date=trade_date,
            range_key="daily_growth_rate",
            rank_value=daily_growth_rate,
        )
        rows += 1

    conn.commit()
    return rows


def seed_funds(conn) -> int:
    dates = seed_dates(48)
    rows = 0
    for index, (code, name, fund_type) in enumerate(SEED_FUNDS, start=1):
        upsert_fund(
            conn,
            code=code,
            name=name,
            fund_type=fund_type,
            purchase_status="开放申购",
            redeem_status="开放赎回",
            source="seed",
        )
        values = deterministic_walk(1 + index * 0.08, len(dates), index * 17)
        previous = None
        for date, value in zip(dates, values):
            daily_value = None if previous is None else value - previous
            daily_rate = None if previous is None else (value / previous - 1) * 100
            upsert_fund_nav(
                conn,
                fund_code=code,
                trade_date=date_iso(date),
                unit_nav=round(value, 4),
                accumulated_nav=round(value + 1.2 + index * 0.15, 4),
                previous_unit_nav=round(previous, 4) if previous else None,
                daily_growth_value=round(daily_value, 4) if daily_value is not None else None,
                daily_growth_rate=round(daily_rate, 2) if daily_rate is not None else None,
                growth_rate_source="seed",
                subscription_status="开放申购",
                redemption_status="开放赎回",
                source="seed",
            )
            previous = value
        upsert_fund_rank(
            conn,
            fund_code=code,
            rank_date=date_iso(dates[-1]),
            range_key="daily_growth_rate",
            rank_value=round(((values[-1] / values[-2]) - 1) * 100, 2),
            source="seed",
        )
        rows += 1
    conn.commit()
    return rows
