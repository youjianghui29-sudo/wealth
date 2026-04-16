from __future__ import annotations

from collector_common import connect


SCHEMA_SQL = [
    """
    CREATE TABLE IF NOT EXISTS Fund (
      code TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      pinyin TEXT,
      fundType TEXT,
      purchaseStatus TEXT,
      redeemStatus TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      updatedAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS Fund_name_idx ON Fund(name)",
    "CREATE INDEX IF NOT EXISTS Fund_fundType_idx ON Fund(fundType)",
    """
    CREATE TABLE IF NOT EXISTS FundMoneyDaily (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      fundName TEXT NOT NULL,
      tradeDate DATETIME NOT NULL,
      tenThousandIncome REAL,
      sevenDayAnnualized REAL,
      unitNav REAL,
      previousTenThousandIncome REAL,
      previousSevenDayAnnualized REAL,
      previousUnitNav REAL,
      dailyGrowthRate REAL,
      inceptionDate DATETIME,
      managerNames TEXT,
      fee TEXT,
      purchaseStatus TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundMoneyDaily_fundCode_tradeDate_key ON FundMoneyDaily(fundCode, tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundMoneyDaily_tradeDate_idx ON FundMoneyDaily(tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundMoneyDaily_sevenDayAnnualized_idx ON FundMoneyDaily(sevenDayAnnualized)",
    """
    CREATE TABLE IF NOT EXISTS FundExchangeQuote (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      fundName TEXT NOT NULL,
      exchangeType TEXT NOT NULL,
      tradeDate DATETIME NOT NULL,
      latestPrice REAL,
      iopv REAL,
      discountRate REAL,
      changeValue REAL,
      changeRate REAL,
      volume REAL,
      amount REAL,
      openPrice REAL,
      highPrice REAL,
      lowPrice REAL,
      previousClose REAL,
      turnoverRate REAL,
      latestShare REAL,
      circulatingMarketValue REAL,
      totalMarketValue REAL,
      updateTime DATETIME,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundExchangeQuote_fundCode_exchangeType_tradeDate_key ON FundExchangeQuote(fundCode, exchangeType, tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundExchangeQuote_exchangeType_tradeDate_idx ON FundExchangeQuote(exchangeType, tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundExchangeQuote_changeRate_idx ON FundExchangeQuote(changeRate)",
    """
    CREATE TABLE IF NOT EXISTS FundProfile (
      fundCode TEXT NOT NULL PRIMARY KEY,
      fullName TEXT,
      inceptionDate DATETIME,
      latestScale TEXT,
      fundCompany TEXT,
      managerNames TEXT,
      custodianBank TEXT,
      fundTypeDetail TEXT,
      ratingAgency TEXT,
      rating TEXT,
      investmentStrategy TEXT,
      investmentObjective TEXT,
      benchmark TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      updatedAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundProfile_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS FundNavDaily (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      tradeDate DATETIME NOT NULL,
      unitNav REAL,
      accumulatedNav REAL,
      previousUnitNav REAL,
      dailyGrowthValue REAL,
      dailyGrowthRate REAL,
      growthRateSource TEXT NOT NULL DEFAULT 'source',
      subscriptionStatus TEXT,
      redemptionStatus TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundNavDaily_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundNavDaily_fundCode_tradeDate_key ON FundNavDaily(fundCode, tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundNavDaily_tradeDate_idx ON FundNavDaily(tradeDate)",
    "CREATE INDEX IF NOT EXISTS FundNavDaily_dailyGrowthRate_idx ON FundNavDaily(dailyGrowthRate)",
    """
    CREATE TABLE IF NOT EXISTS FundRankDaily (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      rankDate DATETIME NOT NULL,
      rangeKey TEXT NOT NULL,
      rankValue REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundRankDaily_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundRankDaily_fundCode_rankDate_rangeKey_key ON FundRankDaily(fundCode, rankDate, rangeKey)",
    "CREATE INDEX IF NOT EXISTS FundRankDaily_rankDate_idx ON FundRankDaily(rankDate)",
    "CREATE INDEX IF NOT EXISTS FundRankDaily_rangeKey_idx ON FundRankDaily(rangeKey)",
    """
    CREATE TABLE IF NOT EXISTS FundHolding (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      reportPeriod TEXT NOT NULL,
      stockCode TEXT NOT NULL,
      stockName TEXT NOT NULL,
      ratio REAL,
      shares REAL,
      marketValue REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundHolding_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundHolding_fundCode_reportPeriod_stockCode_stockName_key ON FundHolding(fundCode, reportPeriod, stockCode, stockName)",
    "CREATE INDEX IF NOT EXISTS FundHolding_fundCode_reportPeriod_idx ON FundHolding(fundCode, reportPeriod)",
    "CREATE INDEX IF NOT EXISTS FundHolding_stockCode_idx ON FundHolding(stockCode)",
    """
    CREATE TABLE IF NOT EXISTS FundBondHolding (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      reportPeriod TEXT NOT NULL,
      bondCode TEXT NOT NULL,
      bondName TEXT NOT NULL,
      ratio REAL,
      marketValue REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundBondHolding_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundBondHolding_fundCode_reportPeriod_bondCode_bondName_key ON FundBondHolding(fundCode, reportPeriod, bondCode, bondName)",
    "CREATE INDEX IF NOT EXISTS FundBondHolding_fundCode_reportPeriod_idx ON FundBondHolding(fundCode, reportPeriod)",
    "CREATE INDEX IF NOT EXISTS FundBondHolding_bondCode_idx ON FundBondHolding(bondCode)",
    """
    CREATE TABLE IF NOT EXISTS FundPortfolioChange (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      reportYear TEXT NOT NULL,
      changeType TEXT NOT NULL,
      stockCode TEXT NOT NULL,
      stockName TEXT NOT NULL,
      amount REAL,
      ratio REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundPortfolioChange_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundPortfolioChange_fundCode_reportYear_changeType_stockCode_stockName_key ON FundPortfolioChange(fundCode, reportYear, changeType, stockCode, stockName)",
    "CREATE INDEX IF NOT EXISTS FundPortfolioChange_fundCode_reportYear_idx ON FundPortfolioChange(fundCode, reportYear)",
    """
    CREATE TABLE IF NOT EXISTS FundIndustryAllocation (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      reportDate DATETIME NOT NULL,
      industryName TEXT NOT NULL,
      ratio REAL,
      marketValue REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundIndustryAllocation_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundIndustryAllocation_fundCode_reportDate_industryName_key ON FundIndustryAllocation(fundCode, reportDate, industryName)",
    "CREATE INDEX IF NOT EXISTS FundIndustryAllocation_fundCode_reportDate_idx ON FundIndustryAllocation(fundCode, reportDate)",
    """
    CREATE TABLE IF NOT EXISTS FundMarketScale (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      reportDate DATETIME NOT NULL,
      fundCount INTEGER,
      purchaseAmount REAL,
      redeemAmount REAL,
      totalShare REAL,
      netAsset REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundMarketScale_reportDate_key ON FundMarketScale(reportDate)",
    """
    CREATE TABLE IF NOT EXISTS FundHolderStructure (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      reportDate DATETIME NOT NULL,
      fundCount INTEGER,
      institutionRatio REAL,
      individualRatio REAL,
      internalRatio REAL,
      totalShare REAL,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundHolderStructure_reportDate_key ON FundHolderStructure(reportDate)",
    """
    CREATE TABLE IF NOT EXISTS FundFee (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      feeType TEXT NOT NULL,
      conditionName TEXT NOT NULL,
      feeValue TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundFee_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundFee_fundCode_feeType_conditionName_key ON FundFee(fundCode, feeType, conditionName)",
    "CREATE INDEX IF NOT EXISTS FundFee_fundCode_feeType_idx ON FundFee(fundCode, feeType)",
    """
    CREATE TABLE IF NOT EXISTS FundRating (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      fundName TEXT,
      managerNames TEXT,
      fundCompany TEXT,
      ratingDate DATETIME,
      fiveStarCount INTEGER,
      shRating REAL,
      zsRating REAL,
      jaRating REAL,
      morningstar REAL,
      fee TEXT,
      fundType TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundRating_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundRating_fundCode_source_key ON FundRating(fundCode, source)",
    "CREATE INDEX IF NOT EXISTS FundRating_fundCompany_idx ON FundRating(fundCompany)",
    "CREATE INDEX IF NOT EXISTS FundRating_fiveStarCount_idx ON FundRating(fiveStarCount)",
    """
    CREATE TABLE IF NOT EXISTS FundManager (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      managerId TEXT,
      managerName TEXT NOT NULL,
      fundCompany TEXT,
      currentFundNum INTEGER,
      bestReturn REAL,
      totalReturn REAL,
      startDate DATETIME,
      source TEXT NOT NULL DEFAULT 'akshare',
      rawSummary TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundManager_managerName_fundCompany_key ON FundManager(managerName, fundCompany)",
    "CREATE INDEX IF NOT EXISTS FundManager_fundCompany_idx ON FundManager(fundCompany)",
    """
    CREATE TABLE IF NOT EXISTS WealthProduct (
      registerCode TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      issuer TEXT,
      riskLevel TEXT,
      operationMode TEXT,
      productType TEXT,
      saleStatus TEXT,
      performanceBenchmark TEXT,
      minPurchaseAmount REAL,
      investmentTerm TEXT,
      openDate DATETIME,
      nextOpenDate DATETIME,
      redeemArrival TEXT,
      managerName TEXT,
      custodianName TEXT,
      feeSummary TEXT,
      assetAllocation TEXT,
      liquidityNote TEXT,
      latestDisclosureAt DATETIME,
      source TEXT NOT NULL DEFAULT 'chinawealth',
      sourceUrl TEXT,
      updatedAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS WealthProduct_name_idx ON WealthProduct(name)",
    "CREATE INDEX IF NOT EXISTS WealthProduct_issuer_idx ON WealthProduct(issuer)",
    "CREATE INDEX IF NOT EXISTS WealthProduct_riskLevel_idx ON WealthProduct(riskLevel)",
    """
    CREATE TABLE IF NOT EXISTS FundDividend (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      fundCode TEXT NOT NULL,
      fundName TEXT,
      eventKey TEXT NOT NULL,
      dividendType TEXT NOT NULL,
      registrationDate DATETIME,
      exDividendDate DATETIME,
      paymentDate DATETIME,
      dividendPerShare REAL,
      dividendPer10 REAL,
      cumulativeDividend REAL,
      cumulativeCount INTEGER,
      announcementTitle TEXT,
      announcementUrl TEXT,
      source TEXT NOT NULL DEFAULT 'akshare',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FundDividend_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS FundDividend_fundCode_eventKey_source_key ON FundDividend(fundCode, eventKey, source)",
    "CREATE INDEX IF NOT EXISTS FundDividend_registrationDate_idx ON FundDividend(registrationDate)",
    "CREATE INDEX IF NOT EXISTS FundDividend_exDividendDate_idx ON FundDividend(exDividendDate)",
    "CREATE INDEX IF NOT EXISTS FundDividend_paymentDate_idx ON FundDividend(paymentDate)",
    """
    CREATE TABLE IF NOT EXISTS PortfolioHolding (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      targetType TEXT NOT NULL,
      targetKey TEXT NOT NULL,
      fundCode TEXT,
      registerCode TEXT,
      displayName TEXT,
      shares REAL,
      costAmount REAL,
      costPrice REAL,
      purchaseDate DATETIME,
      note TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      CONSTRAINT PortfolioHolding_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT PortfolioHolding_registerCode_fkey FOREIGN KEY (registerCode) REFERENCES WealthProduct(registerCode) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS PortfolioHolding_targetType_targetKey_key ON PortfolioHolding(targetType, targetKey)",
    "CREATE INDEX IF NOT EXISTS PortfolioHolding_targetType_idx ON PortfolioHolding(targetType)",
    "CREATE INDEX IF NOT EXISTS PortfolioHolding_fundCode_idx ON PortfolioHolding(fundCode)",
    "CREATE INDEX IF NOT EXISTS PortfolioHolding_registerCode_idx ON PortfolioHolding(registerCode)",
    """
    CREATE TABLE IF NOT EXISTS AlertRule (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      targetType TEXT NOT NULL,
      targetKey TEXT,
      fundCode TEXT,
      registerCode TEXT,
      metric TEXT NOT NULL,
      threshold REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      CONSTRAINT AlertRule_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT AlertRule_registerCode_fkey FOREIGN KEY (registerCode) REFERENCES WealthProduct(registerCode) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE INDEX IF NOT EXISTS AlertRule_targetType_idx ON AlertRule(targetType)",
    "CREATE INDEX IF NOT EXISTS AlertRule_metric_idx ON AlertRule(metric)",
    "CREATE INDEX IF NOT EXISTS AlertRule_fundCode_idx ON AlertRule(fundCode)",
    "CREATE INDEX IF NOT EXISTS AlertRule_registerCode_idx ON AlertRule(registerCode)",
    """
    CREATE TABLE IF NOT EXISTS WealthNavDaily (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      registerCode TEXT NOT NULL,
      navDate DATETIME NOT NULL,
      netValue REAL,
      accumulatedValue REAL,
      dailyChange REAL,
      dailyChangeRate REAL,
      changeSource TEXT NOT NULL DEFAULT 'calculated',
      source TEXT NOT NULL DEFAULT 'chinawealth',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT WealthNavDaily_registerCode_fkey FOREIGN KEY (registerCode) REFERENCES WealthProduct(registerCode) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS WealthNavDaily_registerCode_navDate_key ON WealthNavDaily(registerCode, navDate)",
    "CREATE INDEX IF NOT EXISTS WealthNavDaily_navDate_idx ON WealthNavDaily(navDate)",
    "CREATE INDEX IF NOT EXISTS WealthNavDaily_dailyChangeRate_idx ON WealthNavDaily(dailyChangeRate)",
    """
    CREATE TABLE IF NOT EXISTS Announcement (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      targetType TEXT NOT NULL,
      fundCode TEXT,
      registerCode TEXT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      publishedAt DATETIME,
      source TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT Announcement_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT Announcement_registerCode_fkey FOREIGN KEY (registerCode) REFERENCES WealthProduct(registerCode) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS Announcement_targetType_title_url_key ON Announcement(targetType, title, url)",
    "CREATE INDEX IF NOT EXISTS Announcement_publishedAt_idx ON Announcement(publishedAt)",
    "CREATE INDEX IF NOT EXISTS Announcement_fundCode_idx ON Announcement(fundCode)",
    "CREATE INDEX IF NOT EXISTS Announcement_registerCode_idx ON Announcement(registerCode)",
    """
    CREATE TABLE IF NOT EXISTS Watchlist (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      targetType TEXT NOT NULL,
      targetKey TEXT NOT NULL,
      fundCode TEXT,
      registerCode TEXT,
      note TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT Watchlist_fundCode_fkey FOREIGN KEY (fundCode) REFERENCES Fund(code) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT Watchlist_registerCode_fkey FOREIGN KEY (registerCode) REFERENCES WealthProduct(registerCode) ON DELETE CASCADE ON UPDATE CASCADE
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS Watchlist_targetType_targetKey_key ON Watchlist(targetType, targetKey)",
    "CREATE INDEX IF NOT EXISTS Watchlist_targetType_idx ON Watchlist(targetType)",
    """
    CREATE TABLE IF NOT EXISTS SyncJob (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      jobType TEXT NOT NULL,
      status TEXT NOT NULL,
      startedAt DATETIME NOT NULL,
      finishedAt DATETIME,
      fundRows INTEGER NOT NULL DEFAULT 0,
      wealthRows INTEGER NOT NULL DEFAULT 0,
      announcementRows INTEGER NOT NULL DEFAULT 0,
      failedSources TEXT,
      message TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS SyncJob_jobType_startedAt_idx ON SyncJob(jobType, startedAt)",
    "CREATE INDEX IF NOT EXISTS SyncJob_status_idx ON SyncJob(status)",
]


WEALTH_PRODUCT_COLUMNS = {
    "performanceBenchmark": "TEXT",
    "minPurchaseAmount": "REAL",
    "investmentTerm": "TEXT",
    "openDate": "DATETIME",
    "nextOpenDate": "DATETIME",
    "redeemArrival": "TEXT",
    "managerName": "TEXT",
    "custodianName": "TEXT",
    "feeSummary": "TEXT",
    "assetAllocation": "TEXT",
    "liquidityNote": "TEXT",
}


def ensure_columns(conn, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def main() -> int:
    conn = connect()
    try:
        for statement in SCHEMA_SQL:
            conn.execute(statement)
        ensure_columns(conn, "WealthProduct", WEALTH_PRODUCT_COLUMNS)
        conn.commit()
    finally:
        conn.close()
    print("Initialized SQLite database at data/wealth.sqlite")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
