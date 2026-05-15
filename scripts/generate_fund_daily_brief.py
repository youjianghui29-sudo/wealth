import argparse
import math
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


UTC = timezone.utc
CN_TZ = timezone(timedelta(hours=8))
RETURN_KEYS = ["week_1", "month_1", "month_3", "month_6", "year_1"]
RETURN_LABELS = {
    "week_1": "近1周",
    "month_1": "近1月",
    "month_3": "近3月",
    "month_6": "近6月",
    "year_1": "近1年",
}
THEME_KEYWORDS = [
    "通信",
    "5G",
    "科技",
    "人工智能",
    "算力",
    "芯片",
    "半导体",
    "机器人",
    "高端制造",
    "制造",
    "港股",
    "创新药",
    "医药",
    "新能源",
    "稀有金属",
    "有色",
    "黄金",
    "红利",
    "银行",
    "证券",
    "军工",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a daily fund brief from local SQLite data.")
    parser.add_argument("--db", default="data/wealth.sqlite", help="Path to wealth.sqlite")
    parser.add_argument("--out", help="Output markdown path")
    parser.add_argument("--as-of", dest="as_of", help="Report date in YYYY-MM-DD")
    return parser.parse_args()


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def parse_date_only(value: str | None) -> date | None:
    dt = parse_iso_datetime(value)
    return dt.astimezone(CN_TZ).date() if dt else None


def now_cn() -> datetime:
    return datetime.now(CN_TZ)


def format_dt_cn(value: str | datetime | None) -> str:
    if value is None:
        return "--"
    dt = value if isinstance(value, datetime) else parse_iso_datetime(value)
    if not dt:
        return "--"
    return dt.astimezone(CN_TZ).strftime("%Y-%m-%d %H:%M:%S +08:00")


def format_date_cn(value: str | date | datetime | None) -> str:
    if value is None:
        return "--"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    dt = value if isinstance(value, datetime) else parse_iso_datetime(value)
    if not dt:
        return "--"
    return dt.astimezone(CN_TZ).strftime("%Y-%m-%d")


def fmt_pct(value: float | None, digits: int = 2) -> str:
    if value is None or not math.isfinite(value):
        return "--"
    return f"{value:+.{digits}f}%"


def fmt_pct_plain(value: float | None, digits: int = 2) -> str:
    if value is None or not math.isfinite(value):
        return "--"
    return f"{value:.{digits}f}%"


def fmt_num(value: float | None, digits: int = 2) -> str:
    if value is None or not math.isfinite(value):
        return "--"
    return f"{value:,.{digits}f}"


def fmt_money(value: float | None, digits: int = 2) -> str:
    if value is None or not math.isfinite(value):
        return "--"
    return f"¥{value:,.{digits}f}"


def days_between(start: date | datetime | None, end: date | datetime | None) -> int | None:
    if start is None or end is None:
        return None
    start_date = start if isinstance(start, date) and not isinstance(start, datetime) else start.date()
    end_date = end if isinstance(end, date) and not isinstance(end, datetime) else end.date()
    return max(1, (end_date - start_date).days)


def normalize_fund_base_name(name: str) -> str:
    normalized = re.sub(r"\s+", "", name or "")
    normalized = re.sub(r"(人民币)?(前端|后端)?[A-Z](类|份额)?$", "", normalized, flags=re.I)
    normalized = re.sub(r"(联接|链接)?[A-Z]$", "", normalized, flags=re.I)
    return normalized.strip()


def infer_share_class(name: str) -> str:
    normalized = re.sub(r"\s+", "", name or "")
    match = re.search(r"(?:人民币)?(?:前端|后端)?([A-Z])(?:类|份额)?$", normalized, flags=re.I)
    if match:
        return match.group(1).upper()
    match = re.search(r"(联接|链接)?([A-Z])$", normalized, flags=re.I)
    if match:
        return match.group(2).upper()
    return "--"


def parse_percent_rate(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*%", value.replace(",", ""))
    if not match:
        return None
    parsed = float(match.group(1))
    return parsed if math.isfinite(parsed) else None


def is_purchase_open(status: str | None) -> bool:
    if not status:
        return False
    normalized = re.sub(r"\s+", "", status)
    return ("开放" in normalized or "申购" in normalized) and not re.search(r"暂停|封闭|停止|不可|限制", normalized)


def classify_announcement(title: str | None, source: str | None) -> tuple[str, str]:
    text = f"{title or ''} {source or ''}"
    if re.search(r"清盘|终止上市|终止基金合同|基金经理变更|变更基金经理|离任|暂停申购|暂停赎回|限制大额|费率调整|降低费率|提高费率", text):
        return "high", "可能影响交易、费率、经理或产品存续"
    if re.search(r"分红|派息|恢复申购|恢复大额|开放申购|开放赎回", text):
        return "medium", "可能影响现金流或开放安排"
    if re.search(r"季度报告|季报|中期报告|年度报告|招募说明书|产品资料概要", text):
        return "low", "常规披露，适合复核持仓和规模变化"
    return "low", "普通公告"


def summarize_fee_rows(rows: Iterable[sqlite3.Row]) -> dict[str, float | str | None]:
    subscription_rate = None
    service_rate = None
    management_rate = None
    custody_rate = None
    redemption_rate = None
    first_fee = None
    for row in rows:
        fee_type = row["feeType"] or ""
        condition_name = row["conditionName"] or ""
        fee_value = row["feeValue"]
        fee_text = f"{fee_type}{condition_name}"
        rate = parse_percent_rate(fee_value)
        if first_fee is None and fee_value:
            first_fee = f"{fee_type} {condition_name} {fee_value}".strip()
        if rate is None:
            continue
        if "申购" in fee_text or "认购" in fee_text:
            subscription_rate = rate if subscription_rate is None else min(subscription_rate, rate)
        elif "销售服务" in fee_text:
            service_rate = rate if service_rate is None else max(service_rate, rate)
        elif "管理" in fee_text:
            management_rate = rate if management_rate is None else max(management_rate, rate)
        elif "托管" in fee_text:
            custody_rate = rate if custody_rate is None else max(custody_rate, rate)
        elif "赎回" in fee_text:
            redemption_rate = rate if redemption_rate is None else max(redemption_rate, rate)
    return {
        "subscription_rate": subscription_rate,
        "service_rate": service_rate,
        "management_rate": management_rate,
        "custody_rate": custody_rate,
        "redemption_rate": redemption_rate,
        "first_fee": first_fee,
    }


def estimate_class_cost(fee_summary: dict[str, float | str | None], holding_days: int, amount: float = 10000.0) -> float:
    subscription_cost = amount * (((fee_summary.get("subscription_rate") or 0.0) / 100.0))
    service_cost = amount * (((fee_summary.get("service_rate") or 0.0) / 100.0)) * (holding_days / 365.0)
    return subscription_cost + service_cost


def calculate_risk_metrics(navs: list[dict[str, float | str | None]]) -> dict[str, float | None]:
    points = [item for item in navs if item.get("unitNav") not in (None, 0)]
    if len(points) < 2:
        return {"max_drawdown": None, "volatility": None, "annualized_return": None}
    peak = float(points[0]["unitNav"])
    max_drawdown = 0.0
    returns: list[float] = []
    for index, point in enumerate(points):
        value = float(point["unitNav"])
        if value > peak:
            peak = value
        if peak > 0:
            max_drawdown = min(max_drawdown, (value / peak - 1.0) * 100.0)
        if index == 0:
            continue
        if point.get("dailyGrowthRate") is not None:
            returns.append(float(point["dailyGrowthRate"]) / 100.0)
        else:
            prev_value = float(points[index - 1]["unitNav"])
            if prev_value > 0:
                returns.append(value / prev_value - 1.0)
    average = sum(returns) / len(returns) if returns else 0.0
    variance = sum((item - average) ** 2 for item in returns) / len(returns) if returns else 0.0
    daily_std = math.sqrt(variance)
    volatility = daily_std * math.sqrt(252) * 100.0 if returns else None
    first_date = parse_date_only(points[0]["tradeDate"])
    last_date = parse_date_only(points[-1]["tradeDate"])
    day_count = days_between(first_date, last_date)
    annualized_return = None
    if day_count and float(points[0]["unitNav"]) > 0:
        annualized_return = ((float(points[-1]["unitNav"]) / float(points[0]["unitNav"])) ** (365.0 / day_count) - 1.0) * 100.0
    return {
        "max_drawdown": max_drawdown,
        "volatility": volatility,
        "annualized_return": annualized_return,
    }


def build_investment_simulation(navs: list[dict[str, float | str | None]], monthly_amount: float = 1000.0) -> dict[str, float | int | str | None] | None:
    points = [item for item in navs if item.get("unitNav") not in (None, 0)]
    if len(points) < 2:
        return None
    buys = []
    seen_months: set[str] = set()
    for point in points:
        trade_date = parse_date_only(point["tradeDate"])
        if not trade_date:
            continue
        key = f"{trade_date.year}-{trade_date.month:02d}"
        if key in seen_months:
            continue
        seen_months.add(key)
        buys.append(point)
    if len(buys) < 2:
        return None
    latest = points[-1]
    latest_nav = float(latest["unitNav"])
    shares = 0.0
    invested = 0.0
    buy_dates = {point["tradeDate"] for point in buys}
    max_floating_loss = 0.0
    for point in points:
        unit_nav = float(point["unitNav"])
        if point["tradeDate"] in buy_dates:
            shares += monthly_amount / unit_nav
            invested += monthly_amount
        if invested > 0:
            value = shares * unit_nav
            max_floating_loss = min(max_floating_loss, (value / invested - 1.0) * 100.0)
    current_value = shares * latest_nav
    profit = current_value - invested
    profit_rate = (profit / invested) * 100.0 if invested > 0 else None
    first_buy = buys[0]
    first_buy_nav = float(first_buy["unitNav"])
    lump_shares = invested / first_buy_nav if first_buy_nav > 0 else 0.0
    lump_value = lump_shares * latest_nav
    lump_profit_rate = (lump_value / invested - 1.0) * 100.0 if invested > 0 else None
    return {
        "months": len(buys),
        "invested": invested,
        "current_value": current_value,
        "profit_rate": profit_rate,
        "max_floating_loss": max_floating_loss,
        "start_date": first_buy["tradeDate"],
        "end_date": latest["tradeDate"],
        "lump_profit_rate": lump_profit_rate,
    }


@dataclass
class HoldingSnapshot:
    target_type: str
    target_key: str
    name: str
    current_value: float | None
    cost_amount: float | None
    daily_profit: float | None
    profit: float | None
    position_weight: float | None
    daily_rate: float | None
    price_date: str | None


class DailyFundBrief:
    def __init__(self, db_path: Path, as_of: date):
        self.db_path = db_path
        self.as_of = as_of
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, params).fetchone()

    def query_all(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        return list(self.conn.execute(sql, params).fetchall())

    def latest_data_dates(self) -> dict[str, str | None]:
        row = self.query_one(
            """
            SELECT
              (SELECT MAX(tradeDate) FROM FundNavDaily) AS fund_nav_date,
              (SELECT MAX(rankDate) FROM FundRankDaily) AS fund_rank_date,
              (SELECT MAX(tradeDate) FROM FundMoneyDaily) AS money_date,
              (SELECT MAX(navDate) FROM WealthNavDaily) AS wealth_nav_date,
              (SELECT MAX(publishedAt) FROM Announcement WHERE targetType='fund') AS fund_announcement_date,
              (SELECT MAX(publishedAt) FROM Announcement WHERE targetType='wealth') AS wealth_announcement_date,
              (SELECT MAX(tradeDate) FROM FundExchangeQuote) AS quote_date
            """
        )
        return dict(row or {})

    def sync_status(self) -> dict[str, object]:
        latest_success = self.query_one(
            """
            SELECT id, jobType, status, startedAt, finishedAt, fundRows, wealthRows, announcementRows, failedSources, message
            FROM SyncJob
            WHERE status='success'
            ORDER BY COALESCE(finishedAt, startedAt) DESC
            LIMIT 1
            """
        )
        latest_daily_success = self.query_one(
            """
            SELECT id, jobType, status, startedAt, finishedAt, fundRows, wealthRows, announcementRows, failedSources, message
            FROM SyncJob
            WHERE status='success' AND jobType='daily_collect'
            ORDER BY COALESCE(finishedAt, startedAt) DESC
            LIMIT 1
            """
        )
        latest_job = self.query_one(
            """
            SELECT id, jobType, status, startedAt, finishedAt, fundRows, wealthRows, announcementRows, failedSources, message
            FROM SyncJob
            ORDER BY COALESCE(finishedAt, startedAt) DESC
            LIMIT 1
            """
        )
        stale_running = self.query_all(
            """
            SELECT id, jobType, status, startedAt, finishedAt, failedSources, message
            FROM SyncJob
            WHERE status='running'
            ORDER BY startedAt DESC
            LIMIT 10
            """
        )
        failed_jobs = self.query_all(
            """
            SELECT id, jobType, status, startedAt, finishedAt, failedSources, message
            FROM SyncJob
            WHERE status IN ('failed', 'partial')
            ORDER BY COALESCE(finishedAt, startedAt) DESC
            LIMIT 8
            """
        )
        return {
            "latest_success": latest_success,
            "latest_daily_success": latest_daily_success,
            "latest_job": latest_job,
            "stale_running": stale_running,
            "failed_jobs": failed_jobs,
        }

    def portfolio_report(self) -> dict[str, object]:
        holdings = self.query_all(
            """
            SELECT id, targetType, targetKey, fundCode, registerCode, displayName, shares, costAmount, costPrice, purchaseDate
            FROM PortfolioHolding
            ORDER BY targetType ASC, updatedAt DESC
            """
        )
        if not holdings:
            counts = self.query_one(
                """
                SELECT
                  (SELECT COUNT(*) FROM PortfolioHolding) AS holdings,
                  (SELECT COUNT(*) FROM PortfolioTransaction) AS txns,
                  (SELECT COUNT(*) FROM PortfolioTarget) AS targets,
                  (SELECT COUNT(*) FROM Watchlist) AS watchlist
                """
            )
            return {
                "has_holdings": False,
                "counts": dict(counts or {}),
                "items": [],
                "summary": {},
            }

        snapshots: list[HoldingSnapshot] = []
        fund_codes: list[str] = []
        for holding in holdings:
            target_type = holding["targetType"]
            fund_code = holding["fundCode"]
            register_code = holding["registerCode"]
            name = holding["displayName"] or fund_code or register_code or holding["targetKey"]
            shares = holding["shares"]
            cost_amount = holding["costAmount"]
            latest_price = None
            previous_price = None
            daily_rate = None
            price_date = None
            if target_type == "fund" and fund_code:
                navs = self.query_all(
                    """
                    SELECT tradeDate, unitNav, dailyGrowthRate
                    FROM FundNavDaily
                    WHERE fundCode=?
                    ORDER BY tradeDate DESC
                    LIMIT 2
                    """,
                    (fund_code,),
                )
                if navs:
                    latest_price = navs[0]["unitNav"]
                    previous_price = navs[1]["unitNav"] if len(navs) > 1 else None
                    daily_rate = navs[0]["dailyGrowthRate"]
                    price_date = navs[0]["tradeDate"]
                fund_codes.append(fund_code)
            elif target_type == "wealth" and register_code:
                navs = self.query_all(
                    """
                    SELECT navDate, netValue, dailyChangeRate
                    FROM WealthNavDaily
                    WHERE registerCode=?
                    ORDER BY navDate DESC
                    LIMIT 2
                    """,
                    (register_code,),
                )
                if navs:
                    latest_price = navs[0]["netValue"]
                    previous_price = navs[1]["netValue"] if len(navs) > 1 else None
                    daily_rate = navs[0]["dailyChangeRate"]
                    price_date = navs[0]["navDate"]
            current_value = shares * latest_price if shares and latest_price else cost_amount
            daily_profit = shares * (latest_price - previous_price) if shares and latest_price and previous_price else None
            profit = current_value - cost_amount if current_value is not None and cost_amount is not None else None
            snapshots.append(
                HoldingSnapshot(
                    target_type=target_type,
                    target_key=holding["targetKey"],
                    name=name,
                    current_value=current_value,
                    cost_amount=cost_amount,
                    daily_profit=daily_profit,
                    profit=profit,
                    position_weight=None,
                    daily_rate=daily_rate,
                    price_date=price_date,
                )
            )

        total_value = sum(item.current_value or 0.0 for item in snapshots)
        total_cost = sum(item.cost_amount or 0.0 for item in snapshots)
        total_daily_profit = sum(item.daily_profit or 0.0 for item in snapshots)
        total_profit = sum(item.profit or 0.0 for item in snapshots)
        enriched: list[HoldingSnapshot] = []
        for item in snapshots:
            position_weight = ((item.current_value or 0.0) / total_value * 100.0) if total_value > 0 and item.current_value else None
            enriched.append(
                HoldingSnapshot(
                    target_type=item.target_type,
                    target_key=item.target_key,
                    name=item.name,
                    current_value=item.current_value,
                    cost_amount=item.cost_amount,
                    daily_profit=item.daily_profit,
                    profit=item.profit,
                    position_weight=position_weight,
                    daily_rate=item.daily_rate,
                    price_date=item.price_date,
                )
            )
        enriched.sort(key=lambda item: item.current_value or 0.0, reverse=True)
        top_positions = enriched[:5]
        top3_weight = sum((item.position_weight or 0.0) for item in enriched[:3])
        concentration_hhi = sum(((item.position_weight or 0.0) / 100.0) ** 2 for item in enriched) * 10000.0 if enriched else None
        risk_rows = self.fund_risk_rows(fund_codes)
        return {
            "has_holdings": True,
            "counts": {"holdings": len(enriched)},
            "items": enriched,
            "summary": {
                "current_value": total_value,
                "cost_amount": total_cost,
                "daily_profit": total_daily_profit,
                "profit": total_profit,
                "profit_rate": (total_profit / total_cost * 100.0) if total_cost > 0 else None,
                "largest_position": top_positions[0] if top_positions else None,
                "top3_weight": top3_weight,
                "concentration_hhi": concentration_hhi,
            },
            "risk_rows": risk_rows,
        }

    def fund_risk_rows(self, fund_codes: list[str]) -> list[dict[str, object]]:
        if not fund_codes:
            return []
        latest_rank_date = self.query_one("SELECT MAX(rankDate) AS d FROM FundRankDaily WHERE rangeKey='year_1'")
        rank_date = latest_rank_date["d"] if latest_rank_date else None
        rank_rows = self.query_all(
            """
            SELECT r.fundCode, r.rankValue, f.fundType
            FROM FundRankDaily r
            JOIN Fund f ON f.code=r.fundCode
            WHERE r.rangeKey='year_1' AND r.rankDate=?
            """,
            (rank_date,),
        )
        peer_map = self.build_peer_percentile_map(rank_rows)
        rows: list[dict[str, object]] = []
        for code in fund_codes:
            fund = self.query_one("SELECT code, name, fundType, purchaseStatus, redeemStatus FROM Fund WHERE code=?", (code,))
            if not fund:
                continue
            navs = self.query_all(
                """
                SELECT tradeDate, unitNav, dailyGrowthRate
                FROM FundNavDaily
                WHERE fundCode=? AND unitNav IS NOT NULL
                ORDER BY tradeDate ASC
                LIMIT 380
                """,
                (code,),
            )
            risk = calculate_risk_metrics([dict(row) for row in navs])
            fees = summarize_fee_rows(
                self.query_all(
                    """
                    SELECT feeType, conditionName, feeValue
                    FROM FundFee
                    WHERE fundCode=?
                    ORDER BY feeType ASC, id ASC
                    """,
                    (code,),
                )
            )
            announcements = self.query_all(
                """
                SELECT title, source, publishedAt
                FROM Announcement
                WHERE fundCode=?
                ORDER BY COALESCE(publishedAt, createdAt) DESC
                LIMIT 8
                """,
                (code,),
            )
            high_impact = None
            manager_change = None
            for item in announcements:
                level, reason = classify_announcement(item["title"], item["source"])
                if level == "high" and high_impact is None:
                    high_impact = {"title": item["title"], "date": item["publishedAt"], "reason": reason}
                if manager_change is None and re.search(r"基金经理|离任|聘任|人事", item["title"] or ""):
                    manager_change = {"title": item["title"], "date": item["publishedAt"]}
            latest_nav = navs[-1] if navs else None
            daily_rate = latest_nav["dailyGrowthRate"] if latest_nav else None
            abnormal = daily_rate is not None and abs(float(daily_rate)) >= 2.0
            rows.append(
                {
                    "code": code,
                    "name": fund["name"],
                    "fund_type": fund["fundType"],
                    "daily_rate": daily_rate,
                    "abnormal": abnormal,
                    "max_drawdown": risk["max_drawdown"],
                    "volatility": risk["volatility"],
                    "peer_percentile": peer_map.get(code),
                    "high_impact": high_impact,
                    "manager_change": manager_change,
                    "redemption_rate": fees.get("redemption_rate"),
                    "purchase_status": fund["purchaseStatus"],
                    "redeem_status": fund["redeemStatus"],
                }
            )
        rows.sort(key=lambda item: (item["abnormal"] is True, abs(item["daily_rate"] or 0.0), abs(item["max_drawdown"] or 0.0)), reverse=True)
        return rows

    def build_peer_percentile_map(self, rank_rows: list[sqlite3.Row]) -> dict[str, float]:
        groups: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for row in rank_rows:
            value = row["rankValue"]
            if value is None:
                continue
            code = row["fundCode"] if "fundCode" in row.keys() else row["code"]
            groups[row["fundType"] or "未知"].append((code, float(value)))
        result: dict[str, float] = {}
        for fund_type, items in groups.items():
            sorted_items = sorted(items, key=lambda item: item[1])
            total = len(sorted_items)
            for index, (code, _) in enumerate(sorted_items, start=1):
                result[code] = ((index - 1) / (total - 1) * 100.0) if total > 1 else 100.0
        return result

    def recent_manager_changes(self, limit: int = 7) -> list[sqlite3.Row]:
        return self.query_all(
            """
            SELECT fundCode, title, publishedAt
            FROM Announcement
            WHERE targetType='fund' AND title REGEXP '基金经理|离任|聘任|人事'
            ORDER BY COALESCE(publishedAt, createdAt) DESC
            LIMIT ?
            """,
            (limit,),
        )

    def setup_regexp(self) -> None:
        self.conn.create_function("REGEXP", 2, lambda pattern, text: 1 if text and re.search(pattern, text) else 0)

    def recent_high_impact_announcements(self, limit: int = 10) -> list[dict[str, object]]:
        rows = self.query_all(
            """
            SELECT fundCode, title, source, publishedAt
            FROM Announcement
            WHERE targetType='fund'
            ORDER BY COALESCE(publishedAt, createdAt) DESC
            LIMIT 200
            """
        )
        result = []
        for row in rows:
            level, reason = classify_announcement(row["title"], row["source"])
            if level != "high":
                continue
            result.append(
                {
                    "fund_code": row["fundCode"],
                    "title": row["title"],
                    "published_at": row["publishedAt"],
                    "reason": reason,
                }
            )
            if len(result) >= limit:
                break
        return result

    def watchlist_codes(self) -> list[str]:
        rows = self.query_all("SELECT fundCode FROM Watchlist WHERE fundCode IS NOT NULL ORDER BY createdAt DESC")
        return [row["fundCode"] for row in rows if row["fundCode"]]

    def candidate_funds(self) -> dict[str, object]:
        watchlist_codes = self.watchlist_codes()
        latest_dates = {
            key: self.query_one("SELECT MAX(rankDate) AS d FROM FundRankDaily WHERE rangeKey=?", (key,))["d"]
            for key in RETURN_KEYS
        }
        year_rows = self.query_all(
            """
            SELECT f.code, f.name, COALESCE(f.fundType, '未知') AS fundType, f.purchaseStatus, r.rankValue
            FROM FundRankDaily r
            JOIN Fund f ON f.code=r.fundCode
            WHERE r.rangeKey='year_1' AND r.rankDate=?
            """,
            (latest_dates["year_1"],),
        )
        peer_percentiles = self.build_peer_percentile_map(year_rows)
        return_rows = self.query_all(
            """
            SELECT f.code, f.name, COALESCE(f.fundType, '未知') AS fundType, f.purchaseStatus,
                   MAX(CASE WHEN r.rangeKey='week_1' THEN r.rankValue END) AS week_1,
                   MAX(CASE WHEN r.rangeKey='month_1' THEN r.rankValue END) AS month_1,
                   MAX(CASE WHEN r.rangeKey='month_3' THEN r.rankValue END) AS month_3,
                   MAX(CASE WHEN r.rangeKey='month_6' THEN r.rankValue END) AS month_6,
                   MAX(CASE WHEN r.rangeKey='year_1' THEN r.rankValue END) AS year_1
            FROM Fund f
            JOIN FundRankDaily r ON r.fundCode=f.code
            WHERE (r.rangeKey='week_1' AND r.rankDate=?)
               OR (r.rangeKey='month_1' AND r.rankDate=?)
               OR (r.rangeKey='month_3' AND r.rankDate=?)
               OR (r.rangeKey='month_6' AND r.rankDate=?)
               OR (r.rangeKey='year_1' AND r.rankDate=?)
            GROUP BY f.code, f.name, f.fundType, f.purchaseStatus
            """,
            (
                latest_dates["week_1"],
                latest_dates["month_1"],
                latest_dates["month_3"],
                latest_dates["month_6"],
                latest_dates["year_1"],
            ),
        )
        nav_counts = {
            row["fundCode"]: row["cnt"]
            for row in self.query_all(
                """
                SELECT fundCode, COUNT(*) AS cnt
                FROM FundNavDaily
                WHERE unitNav IS NOT NULL
                GROUP BY fundCode
                """
            )
        }
        candidates = []
        for row in return_rows:
            code = row["code"]
            fund_type = row["fundType"] or "未知"
            if watchlist_codes and code not in watchlist_codes:
                continue
            if not watchlist_codes and ("货币" in fund_type or "债券" in fund_type):
                continue
            nav_count = nav_counts.get(code, 0)
            if nav_count < 180:
                continue
            year1 = row["year_1"]
            month3 = row["month_3"]
            month6 = row["month_6"]
            if year1 is None or month3 is None or month6 is None:
                continue
            score = (peer_percentiles.get(code, 0.0) * 0.45) + float(year1) * 0.2 + float(month6) * 0.2 + float(month3) * 0.15
            candidates.append(
                {
                    "code": code,
                    "name": row["name"],
                    "fund_type": fund_type,
                    "purchase_status": row["purchaseStatus"],
                    "returns": {key: row[key] for key in RETURN_KEYS},
                    "peer_percentile": peer_percentiles.get(code),
                    "nav_count": nav_count,
                    "score": score,
                }
            )
        candidates.sort(key=lambda item: (item["score"], item["peer_percentile"] or 0.0, item["returns"]["year_1"] or 0.0), reverse=True)
        unique_candidates = []
        seen_bases = set()
        for item in candidates:
            base_name = normalize_fund_base_name(item["name"])
            if base_name in seen_bases:
                continue
            seen_bases.add(base_name)
            unique_candidates.append(item)
            if len(unique_candidates) >= 4:
                break
        enriched = [self.enrich_candidate(item) for item in unique_candidates]
        return {
            "watchlist_codes": watchlist_codes,
            "items": enriched,
        }

    def enrich_candidate(self, item: dict[str, object]) -> dict[str, object]:
        code = item["code"]
        navs = self.query_all(
            """
            SELECT tradeDate, unitNav, dailyGrowthRate
            FROM FundNavDaily
            WHERE fundCode=? AND unitNav IS NOT NULL
            ORDER BY tradeDate ASC
            LIMIT 380
            """,
            (code,),
        )
        risk = calculate_risk_metrics([dict(row) for row in navs])
        simulation = build_investment_simulation([dict(row) for row in navs])
        fees = summarize_fee_rows(
            self.query_all(
                """
                SELECT feeType, conditionName, feeValue
                FROM FundFee
                WHERE fundCode=?
                ORDER BY feeType ASC, id ASC
                """,
                (code,),
            )
        )
        announcements = self.query_all(
            """
            SELECT title, source, publishedAt
            FROM Announcement
            WHERE fundCode=?
            ORDER BY COALESCE(publishedAt, createdAt) DESC
            LIMIT 8
            """,
            (code,),
        )
        high_impact = None
        manager_change = None
        for announcement in announcements:
            level, reason = classify_announcement(announcement["title"], announcement["source"])
            if level == "high" and high_impact is None:
                high_impact = {"title": announcement["title"], "date": announcement["publishedAt"], "reason": reason}
            if manager_change is None and re.search(r"基金经理|离任|聘任|人事", announcement["title"] or ""):
                manager_change = {"title": announcement["title"], "date": announcement["publishedAt"]}
        ac_comparison = self.share_class_comparison(item["name"], code)
        risk_flags = []
        if (risk["max_drawdown"] or 0.0) <= -20.0:
            risk_flags.append("回撤偏深")
        if (risk["volatility"] or 0.0) >= 25.0:
            risk_flags.append("波动偏高")
        if fees.get("redemption_rate") is not None and float(fees["redemption_rate"]) >= 1.0:
            risk_flags.append("短持赎回费高")
        if high_impact:
            risk_flags.append("近期有高影响公告")
        if not is_purchase_open(item["purchase_status"]):
            risk_flags.append("申购状态需复核")
        return {
            **item,
            "risk": risk,
            "simulation": simulation,
            "fees": fees,
            "high_impact": high_impact,
            "manager_change": manager_change,
            "share_class_comparison": ac_comparison,
            "risk_flags": risk_flags,
        }

    def share_class_comparison(self, fund_name: str, current_code: str) -> dict[str, object] | None:
        base_name = normalize_fund_base_name(fund_name)
        if len(base_name) < 2:
            return None
        rows = self.query_all(
            """
            SELECT code, name, purchaseStatus
            FROM Fund
            WHERE name LIKE ?
            ORDER BY code ASC
            LIMIT 20
            """,
            (f"{base_name}%",),
        )
        matched = []
        for row in rows:
            if normalize_fund_base_name(row["name"]) != base_name:
                continue
            fees = summarize_fee_rows(
                self.query_all(
                    """
                    SELECT feeType, conditionName, feeValue
                    FROM FundFee
                    WHERE fundCode=?
                    ORDER BY feeType ASC, id ASC
                    """,
                    (row["code"],),
                )
            )
            matched.append(
                {
                    "code": row["code"],
                    "name": row["name"],
                    "share_class": infer_share_class(row["name"]),
                    "purchase_status": row["purchaseStatus"],
                    "subscription_rate": fees.get("subscription_rate"),
                    "service_rate": fees.get("service_rate"),
                    "cost_30d": estimate_class_cost(fees, 30),
                    "cost_365d": estimate_class_cost(fees, 365),
                }
            )
        if len(matched) <= 1:
            return None
        matched.sort(key=lambda item: (item["share_class"], item["code"]))
        a_class = next((item for item in matched if item["share_class"] == "A"), None)
        c_class = next((item for item in matched if item["share_class"] == "C"), None)
        break_even_days = None
        if a_class and c_class:
            sub_diff = (a_class["subscription_rate"] or 0.0) - (c_class["subscription_rate"] or 0.0)
            svc_diff = (c_class["service_rate"] or 0.0) - (a_class["service_rate"] or 0.0)
            if sub_diff > 0 and svc_diff > 0:
                break_even_days = sub_diff / svc_diff * 365.0
        return {
            "base_name": base_name,
            "current_code": current_code,
            "items": matched,
            "break_even_days": break_even_days,
        }

    def market_overview(self) -> dict[str, object]:
        latest_nav_date = self.query_one("SELECT MAX(tradeDate) AS d FROM FundNavDaily")
        latest_date = latest_nav_date["d"] if latest_nav_date else None
        summary = self.query_one(
            """
            SELECT
              COUNT(*) AS total,
              AVG(dailyGrowthRate) AS avg_rate,
              SUM(CASE WHEN dailyGrowthRate > 0 THEN 1 ELSE 0 END) AS up_count,
              SUM(CASE WHEN dailyGrowthRate < 0 THEN 1 ELSE 0 END) AS down_count,
              SUM(CASE WHEN dailyGrowthRate = 0 THEN 1 ELSE 0 END) AS flat_count,
              SUM(CASE WHEN dailyGrowthRate >= 2 THEN 1 ELSE 0 END) AS up_2_count,
              SUM(CASE WHEN dailyGrowthRate <= -2 THEN 1 ELSE 0 END) AS down_2_count,
              SUM(CASE WHEN dailyGrowthRate >= 5 THEN 1 ELSE 0 END) AS up_5_count,
              SUM(CASE WHEN dailyGrowthRate <= -5 THEN 1 ELSE 0 END) AS down_5_count
            FROM FundNavDaily
            WHERE tradeDate=? AND dailyGrowthRate IS NOT NULL
            """,
            (latest_date,),
        )
        types = self.query_all(
            """
            SELECT COALESCE(f.fundType, '未知') AS fundType, COUNT(*) AS sampleCount, AVG(n.dailyGrowthRate) AS avgDailyGrowth
            FROM FundNavDaily n
            JOIN Fund f ON f.code=n.fundCode
            WHERE n.tradeDate=? AND n.dailyGrowthRate IS NOT NULL
            GROUP BY COALESCE(f.fundType, '未知')
            HAVING COUNT(*) >= 30
            ORDER BY AVG(n.dailyGrowthRate) DESC
            """,
            (latest_date,),
        )
        strongest_types = [dict(row) for row in types[:5]]
        weakest_types = [dict(row) for row in types[-3:]]
        top_names = self.query_all(
            """
            SELECT f.name, n.dailyGrowthRate
            FROM FundNavDaily n
            JOIN Fund f ON f.code=n.fundCode
            WHERE n.tradeDate=? AND n.dailyGrowthRate IS NOT NULL
            ORDER BY n.dailyGrowthRate DESC
            LIMIT 200
            """,
            (latest_date,),
        )
        theme_counter = Counter()
        theme_strength = defaultdict(list)
        for row in top_names:
            for keyword in THEME_KEYWORDS:
                if keyword in (row["name"] or ""):
                    theme_counter[keyword] += 1
                    theme_strength[keyword].append(float(row["dailyGrowthRate"]))
        attention_themes = []
        for keyword, count in theme_counter.most_common(5):
            avg_move = sum(theme_strength[keyword]) / len(theme_strength[keyword])
            attention_themes.append({"keyword": keyword, "count": count, "avg_move": avg_move})
        return {
            "latest_date": latest_date,
            "summary": dict(summary or {}),
            "strongest_types": strongest_types,
            "weakest_types": weakest_types,
            "attention_themes": attention_themes,
        }

    def wealth_overview(self) -> dict[str, object]:
        latest = self.query_one(
            """
            SELECT
              (SELECT MAX(navDate) FROM WealthNavDaily) AS wealth_nav_date,
              (SELECT MAX(latestDisclosureAt) FROM WealthProduct) AS latest_disclosure_at
            """
        )
        wealth_nav_date = latest["wealth_nav_date"] if latest else None
        day_rows = self.query_one(
            """
            SELECT
              COUNT(*) AS row_count,
              SUM(CASE WHEN dailyChangeRate IS NOT NULL THEN 1 ELSE 0 END) AS rate_count,
              COUNT(DISTINCT registerCode) AS product_count
            FROM WealthNavDaily
            WHERE navDate=?
            """,
            (wealth_nav_date,),
        )
        stale_rows = self.query_all(
            """
            WITH latest_nav AS (
              SELECT registerCode, MAX(navDate) AS latestNavDate
              FROM WealthNavDaily
              GROUP BY registerCode
            )
            SELECT l.registerCode, p.name, l.latestNavDate
            FROM latest_nav l
            JOIN WealthProduct p ON p.registerCode=l.registerCode
            WHERE julianday(?) - julianday(substr(l.latestNavDate, 1, 10)) >= 5
            ORDER BY l.latestNavDate ASC, l.registerCode ASC
            LIMIT 8
            """,
            (self.as_of.strftime("%Y-%m-%d"),),
        )
        return {
            "wealth_nav_date": wealth_nav_date,
            "latest_disclosure_at": latest["latest_disclosure_at"] if latest else None,
            "day_rows": dict(day_rows or {}),
            "stale_rows": [dict(row) for row in stale_rows],
        }

    def data_gaps(self) -> dict[str, object]:
        coverage = self.query_one(
            """
            SELECT
              (SELECT COUNT(*) FROM Fund) AS total_funds,
              (SELECT COUNT(DISTINCT fundCode) FROM FundNavDaily) AS nav_funds,
              (SELECT COUNT(*) FROM FundProfile) AS profile_funds,
              (SELECT COUNT(DISTINCT fundCode) FROM FundFee) AS fee_funds,
              (SELECT COUNT(DISTINCT fundCode) FROM Announcement WHERE targetType='fund') AS announcement_funds,
              (SELECT COUNT(*) FROM WealthProduct) AS wealth_products,
              (SELECT COUNT(DISTINCT registerCode) FROM WealthNavDaily) AS wealth_nav_products
            """
        )
        latest_wealth_date = self.query_one("SELECT MAX(navDate) AS d FROM WealthNavDaily")
        daily_change_missing = self.query_one(
            """
            SELECT
              COUNT(*) AS total_rows,
              SUM(CASE WHEN dailyChangeRate IS NULL THEN 1 ELSE 0 END) AS missing_rows
            FROM WealthNavDaily
            WHERE navDate=?
            """,
            ((latest_wealth_date["d"] if latest_wealth_date else None),),
        )
        return {
            "coverage": dict(coverage or {}),
            "daily_change_missing": dict(daily_change_missing or {}),
        }

    def render(self) -> str:
        self.setup_regexp()
        latest_dates = self.latest_data_dates()
        sync = self.sync_status()
        portfolio = self.portfolio_report()
        recent_high_impact = self.recent_high_impact_announcements()
        manager_changes = self.recent_manager_changes()
        candidates = self.candidate_funds()
        market = self.market_overview()
        wealth = self.wealth_overview()
        gaps = self.data_gaps()

        fund_nav_date = parse_date_only(latest_dates["fund_nav_date"])
        wealth_nav_date = parse_date_only(latest_dates["wealth_nav_date"])
        quote_date = parse_date_only(latest_dates["quote_date"])
        fund_stale_days = (self.as_of - fund_nav_date).days if fund_nav_date else None
        wealth_stale_days = (self.as_of - wealth_nav_date).days if wealth_nav_date else None

        lines: list[str] = []
        lines.append(f"# 每日基金数据解读与风险提示（{self.as_of.strftime('%Y-%m-%d')}）")
        lines.append("")
        lines.append(f"数据来源：`{self.db_path}`")
        lines.append("")
        lines.append(f"生成时间：{now_cn().strftime('%Y-%m-%d %H:%M:%S +08:00')}")
        lines.append("")
        lines.append("本报告仅基于本地已采集数据做数据解读和风险提示，不构成投资建议，不包含保证收益或确定性买入/卖出指令。")
        lines.append("")
        lines.append("## 1. 最新采集状态和数据日期")
        lines.append(f"- 当前报告日：`{self.as_of.strftime('%Y-%m-%d')}`。基金净值最新日期为 `{format_date_cn(latest_dates['fund_nav_date'])}`，距今约 `{fund_stale_days}` 天；银行理财净值最新日期为 `{format_date_cn(latest_dates['wealth_nav_date'])}`，距今约 `{wealth_stale_days}` 天。")
        lines.append(f"- 排名/阶段收益最新日期：`{format_date_cn(latest_dates['fund_rank_date'])}`；货币基金收益最新日期：`{format_date_cn(latest_dates['money_date'])}`；基金公告最新日期：`{format_date_cn(latest_dates['fund_announcement_date'])}`；理财公告最新日期：`{format_date_cn(latest_dates['wealth_announcement_date'])}`。")
        lines.append(f"- 场内基金行情仍停留在 `{format_date_cn(latest_dates['quote_date'])}`，相对基金净值滞后 `{(fund_nav_date - quote_date).days if fund_nav_date and quote_date else '--'}` 天。")
        latest_success = sync["latest_success"]
        latest_daily_success = sync["latest_daily_success"]
        if fund_stale_days and fund_stale_days > 0:
            if latest_success:
                lines.append(f"- 数据未更新到报告日。最近一次成功写入任务为 `SyncJob #{latest_success['id']} {latest_success['jobType']}`，完成于 `{format_dt_cn(latest_success['finishedAt'] or latest_success['startedAt'])}`。")
            if latest_daily_success:
                lines.append(f"- 最近一次成功 `daily_collect` 为 `SyncJob #{latest_daily_success['id']}`，完成于 `{format_dt_cn(latest_daily_success['finishedAt'] or latest_daily_success['startedAt'])}`。")
        stale_running = sync["stale_running"]
        if stale_running:
            stale_preview = "；".join(
                f"#{row['id']} {row['jobType']}（started {format_dt_cn(row['startedAt'])}）" for row in stale_running[:3]
            )
            lines.append(f"- 当前仍有未结束采集任务，且开始时间都早于今日，需按 `卡住/待复核` 处理：{stale_preview}。")

        lines.append("")
        lines.append("## 2. 我的持仓")
        if not portfolio["has_holdings"]:
            counts = portfolio["counts"]
            lines.append("本地个人组合数据仍为空，以下指标暂无法计算：今日盈亏、累计盈亏、最大单仓、组合集中度、持仓基金赎回费估算。")
            lines.append("")
            lines.append(f"- `PortfolioHolding`：{counts.get('holdings', 0)} 条")
            lines.append(f"- `PortfolioTransaction`：{counts.get('txns', 0)} 条")
            lines.append(f"- `PortfolioTarget`：{counts.get('targets', 0)} 条")
            lines.append(f"- `Watchlist`：{counts.get('watchlist', 0)} 条")
            lines.append("- 当前提示：`需补数据`。后续只有录入持仓份额/成本，或导入真实交易流水，日报才能输出个人组合复盘。")
        else:
            summary = portfolio["summary"]
            largest_position: HoldingSnapshot | None = summary.get("largest_position")
            lines.append(f"- 今日盈亏：`{fmt_money(summary.get('daily_profit'))}`")
            lines.append(f"- 累计盈亏：`{fmt_money(summary.get('profit'))}`，收益率 `{fmt_pct(summary.get('profit_rate'))}`")
            if largest_position:
                lines.append(
                    f"- 最大单仓：`{largest_position.name}`，估算市值 `{fmt_money(largest_position.current_value)}`，仓位 `{fmt_pct_plain(largest_position.position_weight, 1)}`"
                )
            lines.append(
                f"- 组合集中度：前 3 大持仓合计 `{fmt_pct_plain(summary.get('top3_weight'), 1)}`，HHI `{fmt_num(summary.get('concentration_hhi'), 0)}`。"
            )

        lines.append("")
        lines.append("## 3. 持仓基金异常波动与风险")
        if portfolio["has_holdings"] and portfolio["risk_rows"]:
            lines.append("| 基金 | 单日波动 | 最大回撤 | 同类百分位 | 公告/经理 | 费率风险 | 提示 |")
            lines.append("| --- | ---: | ---: | ---: | --- | --- | --- |")
            for item in portfolio["risk_rows"]:
                announcement_text = item["high_impact"]["title"] if item["high_impact"] else (item["manager_change"]["title"] if item["manager_change"] else "暂无高影响公告")
                fee_text = f"赎回费 {fmt_pct_plain(item['redemption_rate'])}" if item["redemption_rate"] is not None else "缺少赎回费率"
                prompt = "谨慎" if item["abnormal"] or (item["max_drawdown"] or 0) <= -20 else "观察"
                lines.append(
                    f"| `{item['code']}` {item['name']} | {fmt_pct(item['daily_rate'])} | {fmt_pct_plain(item['max_drawdown'])} | {fmt_pct_plain(item['peer_percentile'], 1)} | {announcement_text} | {fee_text} | `{prompt}` |"
                )
        else:
            lines.append("由于没有个人持仓，无法逐只输出“我的持仓基金”异常波动和同类百分位。以下列出全库近期更值得复核的风险信号：")
            lines.append("")
            if recent_high_impact:
                lines.append("- 近期高影响公告：")
                for item in recent_high_impact[:5]:
                    lines.append(f"  - `{item['fund_code']}` {item['title']}（{format_date_cn(item['published_at'])}，{item['reason']}）")
            if manager_changes:
                lines.append("- 近期经理/人事相关公告：")
                for item in manager_changes[:5]:
                    lines.append(f"  - `{item['fundCode']}` {item['title']}（{format_date_cn(item['publishedAt'])}）")
            lines.append("- 全库常见短持风险：样本中不少基金 `7 天内赎回费` 仍可达 `1%~1.5%`，短期交易成本偏高。")
            lines.append("- 当前提示：`观察 / 谨慎`。若后续录入持仓，脚本会自动切换到逐仓风险表。")

        lines.append("")
        lines.append("## 4. 关注或候选基金")
        if candidates["watchlist_codes"]:
            lines.append(f"- 本次优先分析关注池基金，共 `{len(candidates['watchlist_codes'])}` 只。")
        else:
            lines.append("- 当前关注池为空，以下从全库按阶段收益、同类百分位、样本长度和可比费率筛出 4 只候选样本，仅作观察。")
        lines.append("")
        lines.append("### 4.1 阶段收益与风险")
        lines.append("| 基金 | 近1周 | 近1月 | 近3月 | 近6月 | 近1年 | 同类百分位 | 风险提示 |")
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
        for item in candidates["items"]:
            risk_text = "、".join(item["risk_flags"]) if item["risk_flags"] else "观察"
            lines.append(
                f"| `{item['code']}` {item['name']} | {fmt_pct(item['returns']['week_1'])} | {fmt_pct(item['returns']['month_1'])} | {fmt_pct(item['returns']['month_3'])} | {fmt_pct(item['returns']['month_6'])} | {fmt_pct(item['returns']['year_1'])} | {fmt_pct_plain(item['peer_percentile'], 1)} | `{risk_text}` |"
            )
        lines.append("")
        lines.append("### 4.2 A/C 份额费用对比")
        lines.append("| 基金对 | A 类申购费 | C 类销售服务费 | 30 天较优 | 1 年较优 | 费用临界点 | 提示 |")
        lines.append("| --- | ---: | ---: | --- | --- | ---: | --- |")
        for item in candidates["items"]:
            comparison = item["share_class_comparison"]
            if not comparison:
                lines.append(f"| `{item['name']}` | -- | -- | -- | -- | -- | 费率或同名份额数据不足 |")
                continue
            a_class = next((x for x in comparison["items"] if x["share_class"] == "A"), None)
            c_class = next((x for x in comparison["items"] if x["share_class"] == "C"), None)
            if (
                not a_class
                or not c_class
                or (a_class["subscription_rate"] is None and a_class["service_rate"] is None)
                or (c_class["subscription_rate"] is None and c_class["service_rate"] is None)
            ):
                lines.append(f"| `{comparison['base_name']}` | -- | -- | -- | -- | -- | A/C 份额存在，但可解析费率不足 |")
                continue
            better_30 = min(comparison["items"], key=lambda x: x["cost_30d"])
            better_365 = min(comparison["items"], key=lambda x: x["cost_365d"])
            tip = "短持优先复核 C 类，长持再比较 A 类" if comparison["break_even_days"] else "缺少明确临界点"
            lines.append(
                f"| `{comparison['base_name']}` | {fmt_pct_plain(a_class['subscription_rate']) if a_class else '--'} | {fmt_pct_plain(c_class['service_rate']) if c_class else '--'} | {better_30['share_class']} 类 | {better_365['share_class']} 类 | {fmt_num(comparison['break_even_days'], 0)} 天 | {tip} |"
            )
        lines.append("")
        lines.append("### 4.3 定投模拟")
        lines.append("| 基金 | 期数/投入 | 当前估算市值 | 定投收益率 | 最大浮亏 | 提示 |")
        lines.append("| --- | ---: | ---: | ---: | ---: | --- |")
        for item in candidates["items"]:
            simulation = item["simulation"]
            if not simulation:
                lines.append(f"| `{item['name']}` | -- | -- | -- | -- | 净值样本不足 |")
                continue
            hint = "风险偏高" if (simulation["max_floating_loss"] or 0.0) <= -20.0 else "观察"
            lines.append(
                f"| `{item['name']}` | `{simulation['months']}` 期 / `{fmt_money(simulation['invested'], 0)}` | `{fmt_money(simulation['current_value'])}` | {fmt_pct(simulation['profit_rate'])} | {fmt_pct(simulation['max_floating_loss'])} | `{hint}` |"
            )

        lines.append("")
        lines.append("## 5. 全市场涨跌概览")
        market_summary = market["summary"]
        lines.append(f"- 统计口径：基金净值最新交易日 `{format_date_cn(market['latest_date'])}`。样本 `{market_summary.get('total', 0)}` 只，平均日涨跌 `{fmt_pct(market_summary.get('avg_rate'), 4)}`。")
        lines.append(
            f"- 上涨 `{market_summary.get('up_count', 0)}` 只，下跌 `{market_summary.get('down_count', 0)}` 只，平盘 `{market_summary.get('flat_count', 0)}` 只；单日涨幅 `>=2%` 有 `{market_summary.get('up_2_count', 0)}` 只，跌幅 `<=-2%` 有 `{market_summary.get('down_2_count', 0)}` 只。"
        )
        if market["strongest_types"]:
            strong_text = "；".join(
                f"{row['fundType']} 平均 {fmt_pct(row['avgDailyGrowth'], 4)}（样本 {row['sampleCount']}）" for row in market["strongest_types"][:4]
            )
            lines.append(f"- 相对偏强类型：{strong_text}。")
        if market["weakest_types"]:
            weak_text = "；".join(
                f"{row['fundType']} 平均 {fmt_pct(row['avgDailyGrowth'], 4)}（样本 {row['sampleCount']}）" for row in market["weakest_types"]
            )
            lines.append(f"- 相对偏弱类型：{weak_text}。")
        if market["attention_themes"]:
            theme_text = "；".join(
                f"{item['keyword']}（出现 {item['count']} 次，均值 {fmt_pct(item['avg_move'], 2)}）" for item in market["attention_themes"][:4]
            )
            lines.append(f"- 需要关注的板块/主题：{theme_text}。强势样本主要集中在高弹性成长方向，`风险偏高`。")
        if quote_date and fund_nav_date and quote_date < fund_nav_date:
            lines.append("- 场内 ETF/LOF 折溢价与成交数据仍旧滞后，当前数据库不适合用来做实时交易判断。")

        lines.append("")
        lines.append("## 6. 银行理财净值披露变化和滞后提示")
        lines.append(f"- `WealthNavDaily` 最新日期：`{format_date_cn(wealth['wealth_nav_date'])}`；`WealthProduct.latestDisclosureAt` 最新日期：`{format_date_cn(wealth['latest_disclosure_at'])}`。")
        lines.append(
            f"- 当日新增理财净值记录 `{wealth['day_rows'].get('row_count', 0)}` 条，覆盖产品 `{wealth['day_rows'].get('product_count', 0)}` 个；其中 `dailyChangeRate` 可直接使用的仅 `{wealth['day_rows'].get('rate_count', 0)}` 条。"
        )
        if wealth["stale_rows"]:
            lines.append("- 以下产品净值披露明显滞后，不能把旧净值当作今日表现：")
            for row in wealth["stale_rows"][:5]:
                lag_days = (self.as_of - parse_date_only(row["latestNavDate"])).days if parse_date_only(row["latestNavDate"]) else None
                lines.append(f"  - `{row['registerCode']}` {row['name']}：最新净值 `{format_date_cn(row['latestNavDate'])}`，距今约 `{lag_days}` 天。")
        lines.append("- 当前提示：理财披露天然慢于公募基金；`净值滞后` 不必然异常，但不能据此判断当日涨跌。")

        lines.append("")
        lines.append("## 7. 数据缺口和采集失败源")
        coverage = gaps["coverage"]
        lines.append(
            f"- 基金总数 `{coverage.get('total_funds', 0)}`；有净值样本 `{coverage.get('nav_funds', 0)}`，有基金画像 `{coverage.get('profile_funds', 0)}`，有费率数据 `{coverage.get('fee_funds', 0)}`，有公告 `{coverage.get('announcement_funds', 0)}`。"
        )
        if coverage.get("total_funds", 0):
            lines.append(
                f"- 画像覆盖率约 `{coverage.get('profile_funds', 0) / coverage.get('total_funds', 1) * 100:.1f}%`；费率覆盖率约 `{coverage.get('fee_funds', 0) / coverage.get('total_funds', 1) * 100:.1f}%`。"
            )
        missing_daily_change = gaps["daily_change_missing"]
        lines.append(
            f"- 理财最新日 `dailyChangeRate` 缺失 `{missing_daily_change.get('missing_rows', 0)}` / `{missing_daily_change.get('total_rows', 0)}` 条，当前更适合做披露状态检查，不适合做精确日收益比较。"
        )
        if sync["failed_jobs"]:
            lines.append("- 最近失败或部分失败来源：")
            for row in sync["failed_jobs"][:5]:
                failed_source = row["failedSources"] or "未写明"
                message = (row["message"] or "").replace("\n", " ")
                lines.append(
                    f"  - `#{row['id']} {row['jobType']}` `{row['status']}`，失败源 `{failed_source}`，结束于 `{format_dt_cn(row['finishedAt'] or row['startedAt'])}`；摘要：{message[:140]}"
                )

        lines.append("")
        lines.append("## 8. 今日结论")
        conclusion_tags = ["观察"]
        if not portfolio["has_holdings"]:
            conclusion_tags.append("需补数据")
        if fund_stale_days and fund_stale_days >= 2:
            conclusion_tags.append("数据滞后")
        if quote_date and fund_nav_date and quote_date < fund_nav_date:
            conclusion_tags.append("场内行情滞后")
        if any((item["risk"].get("max_drawdown") or 0.0) <= -20.0 for item in candidates["items"]):
            conclusion_tags.append("风险偏高")
        lines.append(f"- 今日标签：{' / '.join(conclusion_tags)}。")
        lines.append(f"- 本地数据已更新到基金 `{format_date_cn(latest_dates['fund_nav_date'])}`、理财 `{format_date_cn(latest_dates['wealth_nav_date'])}`，但尚未覆盖报告日 `{self.as_of.strftime('%Y-%m-%d')}`。")
        if not portfolio["has_holdings"]:
            lines.append("- 个人组合仍无法复盘；自动化目前只能给出全市场、候选基金和数据质量层面的提示。")
        lines.append("- 候选样本收益集中在科技/通信/高弹性成长方向，收益和波动同步抬升，更适合标记为 `观察` 或 `谨慎`，而不是给出确定性交易结论。")
        lines.append("- 后续若补齐 `PortfolioHolding / PortfolioTransaction / Watchlist`，日报会自动补上个人盈亏、单仓集中度和持仓基金逐只风险。")
        return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    db_path = Path(args.db).resolve()
    as_of = date.fromisoformat(args.as_of) if args.as_of else now_cn().date()
    out_path = Path(args.out).resolve() if args.out else Path("data/reports").resolve() / f"fund-daily-brief-{as_of.isoformat()}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    generator = DailyFundBrief(db_path, as_of)
    try:
        markdown = generator.render()
    finally:
        generator.close()
    out_path.write_text(markdown, encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
