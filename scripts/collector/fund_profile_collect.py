from __future__ import annotations

import datetime as dt
import os

from collector_common import (
    clean_text,
    date_iso,
    parse_date,
    to_float,
    insert_announcement,
    upsert_fund_bond_holding,
    upsert_fund_fee,
    upsert_fund_holding,
    upsert_fund_industry,
    upsert_portfolio_change,
    upsert_fund_profile,
)


def collect_fund_profiles(
    conn,
    seed: bool = False,
    limit: int | None = None,
    target_codes: list[str] | None = None,
    scope: str = "priority",
) -> int:
    if seed:
        return 0

    try:
        import akshare as ak
    except ImportError:
        return 0

    limit = limit or int(os.getenv("FUND_PROFILE_LIMIT", "80"))
    year = os.getenv("FUND_PORTFOLIO_YEAR", str(dt.date.today().year - 1))
    if target_codes:
        placeholders = ",".join("?" for _ in target_codes)
        rows = conn.execute(
            f"SELECT code FROM Fund WHERE code IN ({placeholders}) ORDER BY code",
            tuple(target_codes),
        ).fetchall()
    else:
        scope_where = ""
        if scope == "portfolio":
            scope_where = "WHERE ph.id IS NOT NULL"
        elif scope == "watchlist":
            scope_where = "WHERE w.id IS NOT NULL"
        rows = conn.execute(
            f"""
            SELECT DISTINCT f.code
            FROM Fund f
            LEFT JOIN FundProfile fp ON fp.fundCode = f.code
            LEFT JOIN Watchlist w ON w.targetType = 'fund' AND w.fundCode = f.code
            LEFT JOIN PortfolioHolding ph ON ph.targetType = 'fund' AND ph.fundCode = f.code
            LEFT JOIN FundNavDaily n ON n.id = (
              SELECT id FROM FundNavDaily latest
              WHERE latest.fundCode = f.code
              ORDER BY latest.tradeDate DESC
              LIMIT 1
            )
            {scope_where}
            ORDER BY
              CASE WHEN ph.id IS NULL THEN 1 ELSE 0 END,
              CASE WHEN fp.fundCode IS NULL THEN 0 ELSE 1 END,
              CASE WHEN w.id IS NULL THEN 1 ELSE 0 END,
              n.dailyGrowthRate DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    collected = 0
    for row in rows:
        code = row["code"]
        try:
            collect_basic_profile(conn, ak, code)
            collect_fees(conn, ak, code)
            collect_holdings(conn, ak, code, year)
            collect_bond_holdings(conn, ak, code, year)
            collect_portfolio_changes(conn, ak, code, year)
            collect_industries(conn, ak, code, year)
            collect_fund_announcements(conn, ak, code)
            conn.commit()
            collected += 1
            if collected % 10 == 0:
                print(f"fund_profiles_progress={collected}/{len(rows)}", flush=True)
        except Exception:
            conn.rollback()
            continue
    return collected


def collect_basic_profile(conn, ak, code: str) -> None:
    df = ak.fund_individual_basic_info_xq(symbol=code)
    if df is None or df.empty:
        return

    data = {}
    for _, row in df.iterrows():
        key = clean_text(row.get("item"))
        value = clean_text(row.get("value"))
        if key:
            data[key] = value

    upsert_fund_profile(
        conn,
        fund_code=code,
        full_name=data.get("基金全称"),
        inception_date=date_iso(parse_date(data.get("成立时间"))) if data.get("成立时间") else None,
        latest_scale=data.get("最新规模"),
        fund_company=data.get("基金公司"),
        manager_names=data.get("基金经理"),
        custodian_bank=data.get("托管银行"),
        fund_type_detail=data.get("基金类型"),
        rating_agency=data.get("评级机构"),
        rating=data.get("基金评级"),
        investment_strategy=data.get("投资策略"),
        investment_objective=data.get("投资目标"),
        benchmark=data.get("业绩比较基准"),
    )


def collect_fees(conn, ak, code: str) -> None:
    df = ak.fund_individual_detail_info_xq(symbol=code)
    if df is None or df.empty:
        return

    for _, row in df.iterrows():
        fee_type = clean_text(row.get("费用类型"))
        condition_name = clean_text(row.get("条件或名称"))
        if not fee_type or not condition_name:
            continue
        upsert_fund_fee(
            conn,
            fund_code=code,
            fee_type=fee_type,
            condition_name=condition_name,
            fee_value=clean_text(row.get("费用")),
        )


def collect_holdings(conn, ak, code: str, year: str) -> None:
    df = ak.fund_portfolio_hold_em(symbol=code, date=year)
    if df is None or df.empty:
        return

    for _, row in df.head(120).iterrows():
        stock_code = clean_text(row.get("股票代码")) or "--"
        stock_name = clean_text(row.get("股票名称")) or "--"
        report_period = clean_text(row.get("季度")) or year
        if stock_code == "--" and stock_name == "--":
            continue
        upsert_fund_holding(
            conn,
            fund_code=code,
            report_period=report_period,
            stock_code=stock_code,
            stock_name=stock_name,
            ratio=to_float(row.get("占净值比例")),
            shares=to_float(row.get("持股数")),
            market_value=to_float(row.get("持仓市值")),
        )


def collect_industries(conn, ak, code: str, year: str) -> None:
    df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=year)
    if df is None or df.empty:
        return

    for _, row in df.head(80).iterrows():
        industry_name = clean_text(row.get("行业类别"))
        report_date = parse_date(row.get("截止时间"))
        if not industry_name or not report_date:
            continue
        upsert_fund_industry(
            conn,
            fund_code=code,
            report_date=date_iso(report_date),
            industry_name=industry_name,
            ratio=to_float(row.get("占净值比例")),
            market_value=to_float(row.get("市值")),
        )


def collect_bond_holdings(conn, ak, code: str, year: str) -> None:
    try:
        df = ak.fund_portfolio_bond_hold_em(symbol=code, date=year)
    except Exception:
        return
    if df is None or df.empty:
        return

    for _, row in df.head(120).iterrows():
        bond_code = clean_text(row.get("债券代码")) or "--"
        bond_name = clean_text(row.get("债券名称")) or "--"
        report_period = clean_text(row.get("季度")) or year
        if bond_code == "--" and bond_name == "--":
            continue
        upsert_fund_bond_holding(
            conn,
            fund_code=code,
            report_period=report_period,
            bond_code=bond_code,
            bond_name=bond_name,
            ratio=to_float(row.get("占净值比例")),
            market_value=to_float(row.get("持仓市值")),
        )


def collect_portfolio_changes(conn, ak, code: str, year: str) -> None:
    for change_type in ["累计买入", "累计卖出"]:
        try:
            df = ak.fund_portfolio_change_em(symbol=code, indicator=change_type, date=year)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.head(80).iterrows():
            stock_code = clean_text(row.get("股票代码")) or clean_text(row.get("代码")) or "--"
            stock_name = clean_text(row.get("股票名称")) or clean_text(row.get("名称")) or "--"
            if stock_code == "--" and stock_name == "--":
                continue
            upsert_portfolio_change(
                conn,
                fund_code=code,
                report_year=year,
                change_type=change_type,
                stock_code=stock_code,
                stock_name=stock_name,
                amount=to_float(row.get("本期累计买入金额")) or to_float(row.get("本期累计卖出金额")) or to_float(row.get("金额")),
                ratio=to_float(row.get("占期初基金资产净值比例")) or to_float(row.get("占期末基金资产净值比例")) or to_float(row.get("占净值比例")),
            )


def collect_fund_announcements(conn, ak, code: str) -> None:
    for source_name, fn_name in [
        ("dividend", "fund_announcement_dividend_em"),
        ("personnel", "fund_announcement_personnel_em"),
        ("report", "fund_announcement_report_em"),
    ]:
        fn = getattr(ak, fn_name, None)
        if not fn:
            continue
        try:
            df = fn(symbol=code)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.head(80).iterrows():
            title = clean_text(row.get("公告标题"))
            report_id = clean_text(row.get("报告ID"))
            published = parse_date(row.get("公告日期"))
            if not title:
                continue
            url = f"https://fundf10.eastmoney.com/jjgg_{code}.html"
            if report_id:
                url = f"https://pdf.dfcfw.com/pdf/H2_{report_id}_1.pdf"
            insert_announcement(
                conn,
                target_type="fund",
                fund_code=code,
                title=title,
                url=url,
                source=f"akshare-{source_name}",
                published_at=date_iso(published) if published else None,
            )
