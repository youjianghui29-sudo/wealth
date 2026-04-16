from __future__ import annotations

import datetime as dt
import math
import re
import sqlite3
from pathlib import Path
from typing import Any, Iterable


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "wealth.sqlite"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 60000")
    return conn


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_date(value: Any) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none", "--"}:
        return None
    text = text.replace("年", "-").replace("月", "-").replace("日", "")
    match = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", text)
    if match:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


def date_iso(value: dt.date | dt.datetime | str | None = None) -> str:
    if value is None:
        value = dt.date.today()
    if isinstance(value, dt.datetime):
        date = value.date()
    elif isinstance(value, dt.date):
        date = value
    else:
        date = parse_date(value) or dt.date.today()
    return f"{date.isoformat()}T00:00:00.000Z"


def detect_date_from_columns(columns: Iterable[str]) -> dt.date:
    for column in columns:
        parsed = parse_date(column)
        if parsed:
            return parsed
    return dt.date.today()


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    text = str(value).strip()
    if not text or text in {"--", "-", "暂无", "nan", "None"}:
        return None
    text = text.replace(",", "").replace("%", "")
    try:
        return float(text)
    except ValueError:
        return None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text.lower() in {"nan", "none", "--"}:
        return None
    return text


def find_col(columns: Iterable[str], include: Iterable[str], exclude: Iterable[str] = ()) -> str | None:
    includes = tuple(include)
    excludes = tuple(exclude)
    for column in columns:
        name = str(column)
        if all(token in name for token in includes) and not any(token in name for token in excludes):
            return name
    return None


def seed_dates(days: int = 42) -> list[dt.date]:
    today = dt.date.today()
    dates: list[dt.date] = []
    cursor = today
    while len(dates) < days:
        if cursor.weekday() < 5:
            dates.append(cursor)
        cursor -= dt.timedelta(days=1)
    return list(reversed(dates))


def deterministic_walk(start: float, days: int, seed: int) -> list[float]:
    import random

    rng = random.Random(seed)
    values = [start]
    for _ in range(days - 1):
        drift = rng.uniform(-0.012, 0.014)
        values.append(max(0.2, values[-1] * (1 + drift)))
    return values


def ensure_schema_exists(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("SELECT 1 FROM Fund LIMIT 1")
    except sqlite3.OperationalError as exc:
        raise RuntimeError("数据库表不存在，请先运行 npm run db:push") from exc


def upsert_fund(conn: sqlite3.Connection, *, code: str, name: str, fund_type: str | None = None,
                purchase_status: str | None = None, redeem_status: str | None = None,
                source: str = "akshare") -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO Fund (code, name, fundType, purchaseStatus, redeemStatus, source, updatedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          fundType = COALESCE(excluded.fundType, Fund.fundType),
          purchaseStatus = COALESCE(excluded.purchaseStatus, Fund.purchaseStatus),
          redeemStatus = COALESCE(excluded.redeemStatus, Fund.redeemStatus),
          source = excluded.source,
          updatedAt = excluded.updatedAt
        """,
        (code, name, fund_type, purchase_status, redeem_status, source, now, now),
    )


def upsert_fund_nav(conn: sqlite3.Connection, *, fund_code: str, trade_date: str,
                    unit_nav: float | None, accumulated_nav: float | None,
                    previous_unit_nav: float | None, daily_growth_value: float | None,
                    daily_growth_rate: float | None, growth_rate_source: str,
                    subscription_status: str | None, redemption_status: str | None,
                    source: str = "akshare") -> None:
    conn.execute(
        """
        INSERT INTO FundNavDaily (
          fundCode, tradeDate, unitNav, accumulatedNav, previousUnitNav,
          dailyGrowthValue, dailyGrowthRate, growthRateSource,
          subscriptionStatus, redemptionStatus, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, tradeDate) DO UPDATE SET
          unitNav = excluded.unitNav,
          accumulatedNav = excluded.accumulatedNav,
          previousUnitNav = excluded.previousUnitNav,
          dailyGrowthValue = excluded.dailyGrowthValue,
          dailyGrowthRate = excluded.dailyGrowthRate,
          growthRateSource = excluded.growthRateSource,
          subscriptionStatus = excluded.subscriptionStatus,
          redemptionStatus = excluded.redemptionStatus,
          source = excluded.source
        """,
        (
            fund_code,
            trade_date,
            unit_nav,
            accumulated_nav,
            previous_unit_nav,
            daily_growth_value,
            daily_growth_rate,
            growth_rate_source,
            subscription_status,
            redemption_status,
            source,
            utc_now(),
        ),
    )


def upsert_fund_rank(conn: sqlite3.Connection, *, fund_code: str, rank_date: str,
                     range_key: str, rank_value: float | None, source: str = "akshare") -> None:
    conn.execute(
        """
        INSERT INTO FundRankDaily (fundCode, rankDate, rangeKey, rankValue, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, rankDate, rangeKey) DO UPDATE SET
          rankValue = excluded.rankValue,
          source = excluded.source
        """,
        (fund_code, rank_date, range_key, rank_value, source, utc_now()),
    )


def upsert_fund_profile(
    conn: sqlite3.Connection,
    *,
    fund_code: str,
    full_name: str | None = None,
    inception_date: str | None = None,
    latest_scale: str | None = None,
    fund_company: str | None = None,
    manager_names: str | None = None,
    custodian_bank: str | None = None,
    fund_type_detail: str | None = None,
    rating_agency: str | None = None,
    rating: str | None = None,
    investment_strategy: str | None = None,
    investment_objective: str | None = None,
    benchmark: str | None = None,
    source: str = "akshare",
) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO FundProfile (
          fundCode, fullName, inceptionDate, latestScale, fundCompany, managerNames,
          custodianBank, fundTypeDetail, ratingAgency, rating, investmentStrategy,
          investmentObjective, benchmark, source, updatedAt, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode) DO UPDATE SET
          fullName = COALESCE(excluded.fullName, FundProfile.fullName),
          inceptionDate = COALESCE(excluded.inceptionDate, FundProfile.inceptionDate),
          latestScale = COALESCE(excluded.latestScale, FundProfile.latestScale),
          fundCompany = COALESCE(excluded.fundCompany, FundProfile.fundCompany),
          managerNames = COALESCE(excluded.managerNames, FundProfile.managerNames),
          custodianBank = COALESCE(excluded.custodianBank, FundProfile.custodianBank),
          fundTypeDetail = COALESCE(excluded.fundTypeDetail, FundProfile.fundTypeDetail),
          ratingAgency = COALESCE(excluded.ratingAgency, FundProfile.ratingAgency),
          rating = COALESCE(excluded.rating, FundProfile.rating),
          investmentStrategy = COALESCE(excluded.investmentStrategy, FundProfile.investmentStrategy),
          investmentObjective = COALESCE(excluded.investmentObjective, FundProfile.investmentObjective),
          benchmark = COALESCE(excluded.benchmark, FundProfile.benchmark),
          source = excluded.source,
          updatedAt = excluded.updatedAt
        """,
        (
            fund_code,
            full_name,
            inception_date,
            latest_scale,
            fund_company,
            manager_names,
            custodian_bank,
            fund_type_detail,
            rating_agency,
            rating,
            investment_strategy,
            investment_objective,
            benchmark,
            source,
            now,
            now,
        ),
    )


def upsert_fund_holding(
    conn: sqlite3.Connection,
    *,
    fund_code: str,
    report_period: str,
    stock_code: str,
    stock_name: str,
    ratio: float | None = None,
    shares: float | None = None,
    market_value: float | None = None,
    source: str = "akshare",
) -> None:
    conn.execute(
        """
        INSERT INTO FundHolding (
          fundCode, reportPeriod, stockCode, stockName, ratio, shares, marketValue, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, reportPeriod, stockCode, stockName) DO UPDATE SET
          ratio = excluded.ratio,
          shares = excluded.shares,
          marketValue = excluded.marketValue,
          source = excluded.source
        """,
        (fund_code, report_period, stock_code, stock_name, ratio, shares, market_value, source, utc_now()),
    )


def upsert_fund_industry(
    conn: sqlite3.Connection,
    *,
    fund_code: str,
    report_date: str,
    industry_name: str,
    ratio: float | None = None,
    market_value: float | None = None,
    source: str = "akshare",
) -> None:
    conn.execute(
        """
        INSERT INTO FundIndustryAllocation (
          fundCode, reportDate, industryName, ratio, marketValue, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, reportDate, industryName) DO UPDATE SET
          ratio = excluded.ratio,
          marketValue = excluded.marketValue,
          source = excluded.source
        """,
        (fund_code, report_date, industry_name, ratio, market_value, source, utc_now()),
    )


def upsert_fund_fee(
    conn: sqlite3.Connection,
    *,
    fund_code: str,
    fee_type: str,
    condition_name: str,
    fee_value: str | None,
    source: str = "akshare",
) -> None:
    conn.execute(
        """
        INSERT INTO FundFee (fundCode, feeType, conditionName, feeValue, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, feeType, conditionName) DO UPDATE SET
          feeValue = excluded.feeValue,
          source = excluded.source
        """,
        (fund_code, fee_type, condition_name, fee_value, source, utc_now()),
    )


def upsert_money_fund_daily(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundMoneyDaily (
          fundCode, fundName, tradeDate, tenThousandIncome, sevenDayAnnualized, unitNav,
          previousTenThousandIncome, previousSevenDayAnnualized, previousUnitNav,
          dailyGrowthRate, inceptionDate, managerNames, fee, purchaseStatus, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, tradeDate) DO UPDATE SET
          fundName = excluded.fundName,
          tenThousandIncome = excluded.tenThousandIncome,
          sevenDayAnnualized = excluded.sevenDayAnnualized,
          unitNav = excluded.unitNav,
          previousTenThousandIncome = excluded.previousTenThousandIncome,
          previousSevenDayAnnualized = excluded.previousSevenDayAnnualized,
          previousUnitNav = excluded.previousUnitNav,
          dailyGrowthRate = excluded.dailyGrowthRate,
          inceptionDate = COALESCE(excluded.inceptionDate, FundMoneyDaily.inceptionDate),
          managerNames = COALESCE(excluded.managerNames, FundMoneyDaily.managerNames),
          fee = COALESCE(excluded.fee, FundMoneyDaily.fee),
          purchaseStatus = COALESCE(excluded.purchaseStatus, FundMoneyDaily.purchaseStatus),
          source = excluded.source
        """,
        (
            kwargs["fund_code"], kwargs["fund_name"], kwargs["trade_date"],
            kwargs.get("ten_thousand_income"), kwargs.get("seven_day_annualized"), kwargs.get("unit_nav"),
            kwargs.get("previous_ten_thousand_income"), kwargs.get("previous_seven_day_annualized"),
            kwargs.get("previous_unit_nav"), kwargs.get("daily_growth_rate"), kwargs.get("inception_date"),
            kwargs.get("manager_names"), kwargs.get("fee"), kwargs.get("purchase_status"),
            kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_exchange_quote(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundExchangeQuote (
          fundCode, fundName, exchangeType, tradeDate, latestPrice, iopv, discountRate,
          changeValue, changeRate, volume, amount, openPrice, highPrice, lowPrice,
          previousClose, turnoverRate, latestShare, circulatingMarketValue, totalMarketValue,
          updateTime, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, exchangeType, tradeDate) DO UPDATE SET
          fundName = excluded.fundName,
          latestPrice = excluded.latestPrice,
          iopv = excluded.iopv,
          discountRate = excluded.discountRate,
          changeValue = excluded.changeValue,
          changeRate = excluded.changeRate,
          volume = excluded.volume,
          amount = excluded.amount,
          openPrice = excluded.openPrice,
          highPrice = excluded.highPrice,
          lowPrice = excluded.lowPrice,
          previousClose = excluded.previousClose,
          turnoverRate = excluded.turnoverRate,
          latestShare = excluded.latestShare,
          circulatingMarketValue = excluded.circulatingMarketValue,
          totalMarketValue = excluded.totalMarketValue,
          updateTime = excluded.updateTime,
          source = excluded.source
        """,
        (
            kwargs["fund_code"], kwargs["fund_name"], kwargs["exchange_type"], kwargs["trade_date"],
            kwargs.get("latest_price"), kwargs.get("iopv"), kwargs.get("discount_rate"),
            kwargs.get("change_value"), kwargs.get("change_rate"), kwargs.get("volume"), kwargs.get("amount"),
            kwargs.get("open_price"), kwargs.get("high_price"), kwargs.get("low_price"),
            kwargs.get("previous_close"), kwargs.get("turnover_rate"), kwargs.get("latest_share"),
            kwargs.get("circulating_market_value"), kwargs.get("total_market_value"),
            kwargs.get("update_time"), kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_market_scale(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundMarketScale (reportDate, fundCount, purchaseAmount, redeemAmount, totalShare, netAsset, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reportDate) DO UPDATE SET
          fundCount = excluded.fundCount,
          purchaseAmount = excluded.purchaseAmount,
          redeemAmount = excluded.redeemAmount,
          totalShare = excluded.totalShare,
          netAsset = excluded.netAsset,
          source = excluded.source
        """,
        (
            kwargs["report_date"], kwargs.get("fund_count"), kwargs.get("purchase_amount"),
            kwargs.get("redeem_amount"), kwargs.get("total_share"), kwargs.get("net_asset"),
            kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_holder_structure(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundHolderStructure (
          reportDate, fundCount, institutionRatio, individualRatio, internalRatio, totalShare, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reportDate) DO UPDATE SET
          fundCount = excluded.fundCount,
          institutionRatio = excluded.institutionRatio,
          individualRatio = excluded.individualRatio,
          internalRatio = excluded.internalRatio,
          totalShare = excluded.totalShare,
          source = excluded.source
        """,
        (
            kwargs["report_date"], kwargs.get("fund_count"), kwargs.get("institution_ratio"),
            kwargs.get("individual_ratio"), kwargs.get("internal_ratio"), kwargs.get("total_share"),
            kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_fund_bond_holding(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundBondHolding (fundCode, reportPeriod, bondCode, bondName, ratio, marketValue, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, reportPeriod, bondCode, bondName) DO UPDATE SET
          ratio = excluded.ratio,
          marketValue = excluded.marketValue,
          source = excluded.source
        """,
        (
            kwargs["fund_code"], kwargs["report_period"], kwargs["bond_code"], kwargs["bond_name"],
            kwargs.get("ratio"), kwargs.get("market_value"), kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_portfolio_change(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundPortfolioChange (fundCode, reportYear, changeType, stockCode, stockName, amount, ratio, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, reportYear, changeType, stockCode, stockName) DO UPDATE SET
          amount = excluded.amount,
          ratio = excluded.ratio,
          source = excluded.source
        """,
        (
            kwargs["fund_code"], kwargs["report_year"], kwargs["change_type"], kwargs["stock_code"],
            kwargs["stock_name"], kwargs.get("amount"), kwargs.get("ratio"), kwargs.get("source", "akshare"),
            utc_now(),
        ),
    )


def upsert_fund_rating(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundRating (
          fundCode, fundName, managerNames, fundCompany, ratingDate, fiveStarCount,
          shRating, zsRating, jaRating, morningstar, fee, fundType, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, source) DO UPDATE SET
          fundName = excluded.fundName,
          managerNames = excluded.managerNames,
          fundCompany = excluded.fundCompany,
          ratingDate = excluded.ratingDate,
          fiveStarCount = excluded.fiveStarCount,
          shRating = excluded.shRating,
          zsRating = excluded.zsRating,
          jaRating = excluded.jaRating,
          morningstar = excluded.morningstar,
          fee = excluded.fee,
          fundType = excluded.fundType
        """,
        (
            kwargs["fund_code"], kwargs.get("fund_name"), kwargs.get("manager_names"), kwargs.get("fund_company"),
            kwargs.get("rating_date"), kwargs.get("five_star_count"), kwargs.get("sh_rating"),
            kwargs.get("zs_rating"), kwargs.get("ja_rating"), kwargs.get("morningstar"),
            kwargs.get("fee"), kwargs.get("fund_type"), kwargs.get("source", "akshare"), utc_now(),
        ),
    )


def upsert_fund_manager(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundManager (
          managerId, managerName, fundCompany, currentFundNum, bestReturn, totalReturn,
          startDate, source, rawSummary, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(managerName, fundCompany) DO UPDATE SET
          managerId = COALESCE(excluded.managerId, FundManager.managerId),
          currentFundNum = COALESCE(excluded.currentFundNum, FundManager.currentFundNum),
          bestReturn = COALESCE(excluded.bestReturn, FundManager.bestReturn),
          totalReturn = COALESCE(excluded.totalReturn, FundManager.totalReturn),
          startDate = COALESCE(excluded.startDate, FundManager.startDate),
          source = excluded.source,
          rawSummary = COALESCE(excluded.rawSummary, FundManager.rawSummary)
        """,
        (
            kwargs.get("manager_id"), kwargs["manager_name"], kwargs.get("fund_company"),
            kwargs.get("current_fund_num"), kwargs.get("best_return"), kwargs.get("total_return"),
            kwargs.get("start_date"), kwargs.get("source", "akshare"), kwargs.get("raw_summary"), utc_now(),
        ),
    )


def upsert_fund_dividend(conn: sqlite3.Connection, **kwargs: Any) -> None:
    conn.execute(
        """
        INSERT INTO FundDividend (
          fundCode, fundName, eventKey, dividendType, registrationDate, exDividendDate,
          paymentDate, dividendPerShare, dividendPer10, cumulativeDividend,
          cumulativeCount, announcementTitle, announcementUrl, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fundCode, eventKey, source) DO UPDATE SET
          fundName = excluded.fundName,
          dividendType = excluded.dividendType,
          registrationDate = excluded.registrationDate,
          exDividendDate = excluded.exDividendDate,
          paymentDate = excluded.paymentDate,
          dividendPerShare = excluded.dividendPerShare,
          dividendPer10 = excluded.dividendPer10,
          cumulativeDividend = excluded.cumulativeDividend,
          cumulativeCount = excluded.cumulativeCount,
          announcementTitle = excluded.announcementTitle,
          announcementUrl = excluded.announcementUrl
        """,
        (
            kwargs["fund_code"],
            kwargs.get("fund_name"),
            kwargs["event_key"],
            kwargs["dividend_type"],
            kwargs.get("registration_date"),
            kwargs.get("ex_dividend_date"),
            kwargs.get("payment_date"),
            kwargs.get("dividend_per_share"),
            kwargs.get("dividend_per10"),
            kwargs.get("cumulative_dividend"),
            kwargs.get("cumulative_count"),
            kwargs.get("announcement_title"),
            kwargs.get("announcement_url"),
            kwargs.get("source", "akshare"),
            utc_now(),
        ),
    )


def upsert_wealth_product(conn: sqlite3.Connection, *, register_code: str, name: str,
                          issuer: str | None, risk_level: str | None,
                          operation_mode: str | None, product_type: str | None,
                          sale_status: str | None, latest_disclosure_at: str | None,
                          source_url: str | None, source: str = "chinawealth",
                          performance_benchmark: str | None = None,
                          min_purchase_amount: float | None = None,
                          investment_term: str | None = None,
                          open_date: str | None = None,
                          next_open_date: str | None = None,
                          redeem_arrival: str | None = None,
                          manager_name: str | None = None,
                          custodian_name: str | None = None,
                          fee_summary: str | None = None,
                          asset_allocation: str | None = None,
                          liquidity_note: str | None = None) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO WealthProduct (
          registerCode, name, issuer, riskLevel, operationMode, productType,
          saleStatus, performanceBenchmark, minPurchaseAmount, investmentTerm,
          openDate, nextOpenDate, redeemArrival, managerName, custodianName,
          feeSummary, assetAllocation, liquidityNote,
          latestDisclosureAt, source, sourceUrl, updatedAt, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(registerCode) DO UPDATE SET
          name = excluded.name,
          issuer = COALESCE(excluded.issuer, WealthProduct.issuer),
          riskLevel = COALESCE(excluded.riskLevel, WealthProduct.riskLevel),
          operationMode = COALESCE(excluded.operationMode, WealthProduct.operationMode),
          productType = COALESCE(excluded.productType, WealthProduct.productType),
          saleStatus = COALESCE(excluded.saleStatus, WealthProduct.saleStatus),
          performanceBenchmark = COALESCE(excluded.performanceBenchmark, WealthProduct.performanceBenchmark),
          minPurchaseAmount = COALESCE(excluded.minPurchaseAmount, WealthProduct.minPurchaseAmount),
          investmentTerm = COALESCE(excluded.investmentTerm, WealthProduct.investmentTerm),
          openDate = COALESCE(excluded.openDate, WealthProduct.openDate),
          nextOpenDate = COALESCE(excluded.nextOpenDate, WealthProduct.nextOpenDate),
          redeemArrival = COALESCE(excluded.redeemArrival, WealthProduct.redeemArrival),
          managerName = COALESCE(excluded.managerName, WealthProduct.managerName),
          custodianName = COALESCE(excluded.custodianName, WealthProduct.custodianName),
          feeSummary = COALESCE(excluded.feeSummary, WealthProduct.feeSummary),
          assetAllocation = COALESCE(excluded.assetAllocation, WealthProduct.assetAllocation),
          liquidityNote = COALESCE(excluded.liquidityNote, WealthProduct.liquidityNote),
          latestDisclosureAt = COALESCE(excluded.latestDisclosureAt, WealthProduct.latestDisclosureAt),
          source = excluded.source,
          sourceUrl = COALESCE(excluded.sourceUrl, WealthProduct.sourceUrl),
          updatedAt = excluded.updatedAt
        """,
        (
            register_code,
            name,
            issuer,
            risk_level,
            operation_mode,
            product_type,
            sale_status,
            performance_benchmark,
            min_purchase_amount,
            investment_term,
            open_date,
            next_open_date,
            redeem_arrival,
            manager_name,
            custodian_name,
            fee_summary,
            asset_allocation,
            liquidity_note,
            latest_disclosure_at,
            source,
            source_url,
            now,
            now,
        ),
    )


def upsert_wealth_nav(conn: sqlite3.Connection, *, register_code: str, nav_date: str,
                      net_value: float | None, accumulated_value: float | None,
                      daily_change: float | None, daily_change_rate: float | None,
                      change_source: str, source: str = "chinawealth") -> None:
    conn.execute(
        """
        INSERT INTO WealthNavDaily (
          registerCode, navDate, netValue, accumulatedValue,
          dailyChange, dailyChangeRate, changeSource, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(registerCode, navDate) DO UPDATE SET
          netValue = excluded.netValue,
          accumulatedValue = excluded.accumulatedValue,
          dailyChange = excluded.dailyChange,
          dailyChangeRate = excluded.dailyChangeRate,
          changeSource = excluded.changeSource,
          source = excluded.source
        """,
        (register_code, nav_date, net_value, accumulated_value, daily_change, daily_change_rate, change_source, source, utc_now()),
    )


def insert_announcement(conn: sqlite3.Connection, *, target_type: str, title: str, url: str,
                        source: str, published_at: str | None = None,
                        fund_code: str | None = None, register_code: str | None = None) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO Announcement (
          targetType, fundCode, registerCode, title, url, publishedAt, source, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (target_type, fund_code, register_code, title, url, published_at, source, utc_now()),
    )


def create_sync_job(conn: sqlite3.Connection, job_type: str) -> int:
    cursor = conn.execute(
        """
        INSERT INTO SyncJob (jobType, status, startedAt, createdAt)
        VALUES (?, ?, ?, ?)
        """,
        (job_type, "running", utc_now(), utc_now()),
    )
    conn.commit()
    return int(cursor.lastrowid)


def finish_sync_job(conn: sqlite3.Connection, job_id: int, *, status: str,
                    fund_rows: int = 0, wealth_rows: int = 0,
                    announcement_rows: int = 0, failed_sources: list[str] | None = None,
                    message: str | None = None) -> None:
    conn.execute(
        """
        UPDATE SyncJob
        SET status = ?, finishedAt = ?, fundRows = ?, wealthRows = ?,
            announcementRows = ?, failedSources = ?, message = ?
        WHERE id = ?
        """,
        (
            status,
            utc_now(),
            fund_rows,
            wealth_rows,
            announcement_rows,
            ",".join(failed_sources or []) or None,
            message,
            job_id,
        ),
    )
    conn.commit()
