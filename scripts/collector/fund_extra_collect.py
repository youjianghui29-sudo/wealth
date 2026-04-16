from __future__ import annotations

import datetime as dt
import os
from typing import Any

from collector_common import (
    clean_text,
    date_iso,
    find_col,
    insert_announcement,
    parse_date,
    to_float,
    upsert_exchange_quote,
    upsert_fund,
    upsert_fund_manager,
    upsert_fund_rating,
    upsert_fund_rank,
    upsert_holder_structure,
    upsert_market_scale,
    upsert_money_fund_daily,
)


RANK_COLUMNS = {
    "日增长率": "daily_growth_rate",
    "近1周": "week_1",
    "近1月": "month_1",
    "近3月": "month_3",
    "近6月": "month_6",
    "近1年": "year_1",
    "近2年": "year_2",
    "近3年": "year_3",
    "今年来": "year_to_date",
    "成立来": "since_inception",
}


def collect_fund_extras(conn, seed: bool = False) -> dict[str, int]:
    if seed:
        return {}

    try:
        import akshare as ak
    except ImportError as exc:
        raise RuntimeError("缺少 Python 依赖 akshare，请运行 pip install -r requirements.txt") from exc

    results = {
        "open_rank": collect_open_rankings(conn, ak),
        "money": collect_money_funds(conn, ak),
        "exchange": collect_exchange_funds(conn, ak),
        "market": collect_market_stats(conn, ak),
        "ratings": collect_ratings(conn, ak),
        "managers": collect_managers(conn, ak),
    }
    conn.commit()
    return results


def collect_open_rankings(conn, ak) -> int:
    symbols = ["全部", "股票型", "混合型", "债券型", "指数型", "QDII", "FOF"]
    rows = 0
    for symbol in symbols:
        try:
            df = ak.fund_open_fund_rank_em(symbol=symbol)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            code = clean_text(row.get("基金代码"))
            name = clean_text(row.get("基金简称"))
            rank_date = parse_date(row.get("日期"))
            if not code or not name or not rank_date or str(rank_date) == "NaT":
                continue
            upsert_fund(conn, code=code, name=name, source="akshare")
            for column, key in RANK_COLUMNS.items():
                if column in row:
                    upsert_fund_rank(
                        conn,
                        fund_code=code,
                        rank_date=date_iso(rank_date),
                        range_key=key,
                        rank_value=to_float(row.get(column)),
                    )
                    rows += 1
    return rows


def collect_money_funds(conn, ak) -> int:
    df = ak.fund_money_fund_daily_em()
    if df is None or df.empty:
        return 0

    columns = [str(c) for c in df.columns]
    latest_date = latest_date_from_columns(columns)
    previous_date = previous_date_from_columns(columns, latest_date)
    rows = 0
    for _, row in df.iterrows():
        code = clean_text(row.get("基金代码"))
        name = clean_text(row.get("基金简称"))
        if not code or not name:
            continue
        upsert_fund(conn, code=code, name=name, fund_type="货币型", source="akshare")
        upsert_money_fund_daily(
            conn,
            fund_code=code,
            fund_name=name,
            trade_date=date_iso(latest_date),
            ten_thousand_income=to_float(row.get(f"{latest_date.isoformat()}-万份收益")),
            seven_day_annualized=to_float(row.get(f"{latest_date.isoformat()}-7日年化%")),
            unit_nav=to_float(row.get(f"{latest_date.isoformat()}-单位净值")),
            previous_ten_thousand_income=to_float(row.get(f"{previous_date.isoformat()}-万份收益")) if previous_date else None,
            previous_seven_day_annualized=to_float(row.get(f"{previous_date.isoformat()}-7日年化%")) if previous_date else None,
            previous_unit_nav=to_float(row.get(f"{previous_date.isoformat()}-单位净值")) if previous_date else None,
            daily_growth_rate=to_float(row.get("日涨幅")),
            inception_date=date_iso(parse_date(row.get("成立日期"))) if parse_date(row.get("成立日期")) else None,
            manager_names=clean_text(row.get("基金经理")),
            fee=clean_text(row.get("手续费")),
            purchase_status=clean_text(row.get("可购全部")),
        )
        rows += 1
    return rows


def collect_exchange_funds(conn, ak) -> int:
    rows = 0
    for exchange_type, fn in [("ETF", ak.fund_etf_spot_em), ("LOF", ak.fund_lof_spot_em)]:
        try:
            df = fn()
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            code = clean_text(row.get("代码"))
            name = clean_text(row.get("名称"))
            if not code or not name:
                continue
            trade_date = parse_date(row.get("数据日期")) or dt.date.today()
            upsert_fund(conn, code=code, name=name, fund_type=exchange_type, source="akshare")
            upsert_exchange_quote(
                conn,
                fund_code=code,
                fund_name=name,
                exchange_type=exchange_type,
                trade_date=date_iso(trade_date),
                latest_price=to_float(row.get("最新价")),
                iopv=to_float(row.get("IOPV实时估值")),
                discount_rate=to_float(row.get("基金折价率")),
                change_value=to_float(row.get("涨跌额")),
                change_rate=to_float(row.get("涨跌幅")),
                volume=to_float(row.get("成交量")),
                amount=to_float(row.get("成交额")),
                open_price=to_float(row.get("开盘价")),
                high_price=to_float(row.get("最高价")),
                low_price=to_float(row.get("最低价")),
                previous_close=to_float(row.get("昨收")),
                turnover_rate=to_float(row.get("换手率")),
                latest_share=to_float(row.get("最新份额")),
                circulating_market_value=to_float(row.get("流通市值")),
                total_market_value=to_float(row.get("总市值")),
                update_time=date_iso(parse_date(row.get("更新时间"))) if parse_date(row.get("更新时间")) else None,
            )
            rows += 1
    return rows


def collect_market_stats(conn, ak) -> int:
    rows = 0
    try:
        scale_df = ak.fund_scale_change_em()
        for _, row in scale_df.iterrows():
            report_date = parse_date(row.get("截止日期"))
            if not report_date:
                continue
            upsert_market_scale(
                conn,
                report_date=date_iso(report_date),
                fund_count=int(to_float(row.get("基金家数")) or 0) or None,
                purchase_amount=to_float(row.get("期间申购")),
                redeem_amount=to_float(row.get("期间赎回")),
                total_share=to_float(row.get("期末总份额")),
                net_asset=to_float(row.get("期末净资产")),
            )
            rows += 1
    except Exception:
        pass
    try:
        holder_df = ak.fund_hold_structure_em()
        for _, row in holder_df.iterrows():
            report_date = parse_date(row.get("截止日期"))
            if not report_date:
                continue
            upsert_holder_structure(
                conn,
                report_date=date_iso(report_date),
                fund_count=int(to_float(row.get("基金家数")) or 0) or None,
                institution_ratio=to_float(row.get("机构持有比列")),
                individual_ratio=to_float(row.get("个人持有比列")),
                internal_ratio=to_float(row.get("内部持有比列")),
                total_share=to_float(row.get("总份额")),
            )
            rows += 1
    except Exception:
        pass
    return rows


def collect_ratings(conn, ak) -> int:
    try:
        df = ak.fund_rating_all()
    except Exception:
        return 0
    if df is None or df.empty:
        return 0

    rows = 0
    for _, row in df.iterrows():
        code = clean_text(row.get("代码"))
        name = clean_text(row.get("简称"))
        if not code:
            continue
        if name:
            upsert_fund(conn, code=code, name=name, source="akshare")
        upsert_fund_rating(
            conn,
            fund_code=code,
            fund_name=name,
            manager_names=clean_text(row.get("基金经理")),
            fund_company=clean_text(row.get("基金公司")),
            five_star_count=int(to_float(row.get("5星评级家数")) or 0),
            sh_rating=to_float(row.get("上海证券")),
            zs_rating=to_float(row.get("招商证券")),
            ja_rating=to_float(row.get("济安金信")),
            morningstar=to_float(row.get("晨星评级")),
            fee=clean_text(row.get("手续费")),
            fund_type=clean_text(row.get("类型")),
        )
        rows += 1
    return rows


def collect_managers(conn, ak) -> int:
    try:
        df = ak.fund_manager_em()
    except Exception:
        return 0
    if df is None or df.empty:
        return 0

    rows = 0
    for _, row in df.iterrows():
        manager_name = first_existing(row, ["姓名", "基金经理", "经理姓名", "现任基金经理"])
        if not manager_name:
            continue
        upsert_fund_manager(
            conn,
            manager_id=first_existing(row, ["经理编号", "基金经理编号", "id"]),
            manager_name=manager_name,
            fund_company=first_existing(row, ["所属公司", "基金公司", "公司"]),
            current_fund_num=int(to_float(first_existing(row, ["现任基金数量", "现任基金"])) or 0) or None,
            best_return=to_float(first_existing(row, ["现任基金最佳回报", "最佳回报"])),
            total_return=to_float(first_existing(row, ["累计从业回报", "任职回报"])),
            start_date=date_iso(parse_date(first_existing(row, ["累计任职时间", "从业起始日期", "上任日期"]))) if parse_date(first_existing(row, ["从业起始日期", "上任日期"])) else None,
            raw_summary=" | ".join(f"{k}:{clean_text(v)}" for k, v in row.to_dict().items() if clean_text(v))[:2000],
        )
        rows += 1
    return rows


def latest_date_from_columns(columns: list[str]) -> dt.date:
    dates = sorted({d for column in columns if (d := parse_date(column))}, reverse=True)
    return dates[0] if dates else dt.date.today()


def previous_date_from_columns(columns: list[str], latest: dt.date) -> dt.date | None:
    dates = sorted({d for column in columns if (d := parse_date(column)) and d < latest}, reverse=True)
    return dates[0] if dates else None


def first_existing(row: Any, columns: list[str]) -> str | None:
    for column in columns:
        try:
            value = clean_text(row.get(column))
        except Exception:
            value = None
        if value:
            return value
    return None
