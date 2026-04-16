import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  ExchangeFundItem,
  FundListItem,
  FundRankingItem,
  MoneyFundItem,
  PagedResult,
  WealthListItem
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const FUND_DETAIL_RETURN_RANGES = [
  { key: "week_1", label: "近1周" },
  { key: "month_1", label: "近1月" },
  { key: "month_3", label: "近3月" },
  { key: "month_6", label: "近6月" },
  { key: "year_1", label: "近1年" },
  { key: "year_to_date", label: "今年来" },
  { key: "since_inception", label: "成立来" }
];

type AlertItem = {
  level: "high" | "medium" | "low";
  targetType: "fund" | "wealth";
  targetKey: string;
  title: string;
  message: string;
  metric: string;
};

function toPositiveInt(value: string | number | undefined | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function clampPageSize(value: string | number | undefined | null) {
  return Math.min(toPositiveInt(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

function toDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start: Date | string | null | undefined, end: Date | string | null | undefined) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) {
    return null;
  }
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
}

function calculateRiskMetrics(
  navs: Array<{ tradeDate: Date | string; unitNav: number | null; dailyGrowthRate: number | null }>
) {
  const points = navs.filter((item) => item.unitNav !== null && item.unitNav !== undefined);
  if (points.length < 2) {
    return {
      maxDrawdown: null,
      volatility: null,
      sharpe: null,
      annualizedReturn: null
    };
  }

  let peak = Number(points[0].unitNav);
  let maxDrawdown = 0;
  for (const point of points) {
    const value = Number(point.unitNav);
    if (value > peak) {
      peak = value;
    }
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
    }
  }

  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (current.dailyGrowthRate !== null && current.dailyGrowthRate !== undefined) {
      returns.push(current.dailyGrowthRate / 100);
    } else if (current.unitNav && previous.unitNav) {
      returns.push(current.unitNav / previous.unitNav - 1);
    }
  }
  const average = returns.length ? returns.reduce((sum, item) => sum + item, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((sum, item) => sum + (item - average) ** 2, 0) / returns.length
    : 0;
  const dailyStd = Math.sqrt(variance);
  const volatility = returns.length ? dailyStd * Math.sqrt(252) * 100 : null;
  const sharpe = dailyStd > 0 ? (average / dailyStd) * Math.sqrt(252) : null;
  const first = points[0];
  const last = points[points.length - 1];
  const dayCount = daysBetween(first.tradeDate, last.tradeDate);
  const annualizedReturn =
    dayCount && first.unitNav && last.unitNav && first.unitNav > 0
      ? ((last.unitNav / first.unitNav) ** (365 / dayCount) - 1) * 100
      : null;

  return {
    maxDrawdown,
    volatility,
    sharpe,
    annualizedReturn
  };
}

function periodChange<T extends { navDate: Date | string; netValue: number | null }>(navs: T[], days: number) {
  const latest = navs.at(-1);
  if (!latest?.netValue) {
    return null;
  }
  const latestDate = toDate(latest.navDate);
  if (!latestDate) {
    return null;
  }
  const targetTime = latestDate.getTime() - days * 86400000;
  const base = [...navs].reverse().find((item) => {
    const date = toDate(item.navDate);
    return date ? date.getTime() <= targetTime && item.netValue : false;
  });
  if (!base?.netValue) {
    return null;
  }
  return (latest.netValue / base.netValue - 1) * 100;
}

function parseScaleYi(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  if (value.includes("万")) {
    return amount / 10000;
  }
  return amount;
}

function toCount(value: unknown) {
  return Number(value ?? 0);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isDatabaseLocked(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("database is locked");
}

async function withDatabaseRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isDatabaseLocked(error) || attempt === attempts - 1) {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

function coverageStatus(ratio: number | null, value: number, goodAt = 90, warnAt = 50) {
  if (ratio === null) {
    return value > 0 ? "good" : "bad";
  }
  if (ratio >= goodAt) {
    return "good";
  }
  if (ratio >= warnAt) {
    return "warn";
  }
  return "bad";
}

function coverageMetric(input: {
  key: string;
  label: string;
  value: number;
  total?: number | null;
  latestDate?: Date | string | null;
  note?: string;
  goodAt?: number;
  warnAt?: number;
}) {
  const ratio = input.total && input.total > 0 ? (input.value / input.total) * 100 : null;
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    total: input.total ?? null,
    ratio,
    latestDate: input.latestDate ?? null,
    status: coverageStatus(ratio, input.value, input.goodAt, input.warnAt),
    note: input.note ?? null
  };
}

export async function getLatestSyncJob() {
  const rows = await withDatabaseRetry(() => prisma.$queryRaw<
    Array<{
      id: number;
      jobType: string;
      status: string;
      startedAt: string | null;
      finishedAt: string | null;
      fundRows: number | null;
      wealthRows: number | null;
      announcementRows: number | null;
      failedSources: string | null;
      message: string | null;
      createdAt: string | null;
    }>
  >`
    SELECT
      id,
      CAST(jobType AS TEXT) AS jobType,
      CAST(status AS TEXT) AS status,
      CAST(startedAt AS TEXT) AS startedAt,
      CAST(finishedAt AS TEXT) AS finishedAt,
      fundRows,
      wealthRows,
      announcementRows,
      CAST(failedSources AS TEXT) AS failedSources,
      CAST(message AS TEXT) AS message,
      CAST(createdAt AS TEXT) AS createdAt
    FROM SyncJob
    ORDER BY startedAt DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getRecentSyncJobs(limit = 30) {
  return withDatabaseRetry(() => prisma.$queryRaw<
    Array<{
      id: number;
      jobType: string;
      status: string;
      startedAt: string | null;
      finishedAt: string | null;
      fundRows: number | null;
      wealthRows: number | null;
      announcementRows: number | null;
      failedSources: string | null;
      message: string | null;
    }>
  >`
    SELECT
      id,
      CAST(jobType AS TEXT) AS jobType,
      CAST(status AS TEXT) AS status,
      CAST(startedAt AS TEXT) AS startedAt,
      CAST(finishedAt AS TEXT) AS finishedAt,
      fundRows,
      wealthRows,
      announcementRows,
      CAST(failedSources AS TEXT) AS failedSources,
      CAST(message AS TEXT) AS message
    FROM SyncJob
    ORDER BY startedAt DESC
    LIMIT ${limit}
  `);
}

export async function getDataCoverage() {
  const [
    fundTotalRows,
    fundNavFundsRows,
    fundNavLatestRows,
    fundHistory14Rows,
    rankLatestRows,
    profileRows,
    feeRows,
    stockHoldingRows,
    bondHoldingRows,
    industryRows,
    portfolioChangeRows,
    dividendRows,
    announcementRows,
    ratingRows,
    moneyLatestRows,
    exchangeLatestRows,
    marketScaleRows,
    wealthTotalRows,
    wealthNavFundsRows,
    wealthLatestRows
  ] = await withDatabaseRetry(() => Promise.all([
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(*) AS value FROM Fund`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundNavDaily`,
    prisma.$queryRaw<Array<{ latestDate: string | null; value: number }>>`
      SELECT MAX(tradeDate) AS latestDate, COUNT(*) AS value
      FROM FundNavDaily
      WHERE tradeDate = (SELECT MAX(tradeDate) FROM FundNavDaily)
    `,
    prisma.$queryRaw<Array<{ value: number }>>`
      SELECT COUNT(*) AS value
      FROM (
        SELECT fundCode
        FROM FundNavDaily
        GROUP BY fundCode
        HAVING COUNT(*) >= 14
      )
    `,
    prisma.$queryRaw<Array<{ latestDate: string | null; value: number; funds: number }>>`
      SELECT MAX(rankDate) AS latestDate, COUNT(*) AS value, COUNT(DISTINCT fundCode) AS funds
      FROM FundRankDaily
      WHERE rankDate = (
        SELECT MAX(rankDate)
        FROM FundRankDaily
        WHERE rankDate LIKE '20%'
      )
    `,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundProfile`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundFee`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundHolding`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundBondHolding`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundIndustryAllocation`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT fundCode) AS value FROM FundPortfolioChange`,
    prisma.$queryRaw<Array<{ value: number; rows: number }>>`
      SELECT COUNT(DISTINCT fundCode) AS value, COUNT(*) AS rows
      FROM FundDividend
    `,
    prisma.$queryRaw<Array<{ value: number; rows: number }>>`
      SELECT COUNT(DISTINCT fundCode) AS value, COUNT(*) AS rows
      FROM Announcement
      WHERE targetType = 'fund'
    `,
    prisma.$queryRaw<Array<{ value: number; rows: number }>>`
      SELECT COUNT(DISTINCT fundCode) AS value, COUNT(*) AS rows
      FROM FundRating
    `,
    prisma.$queryRaw<Array<{ latestDate: string | null; value: number }>>`
      SELECT MAX(tradeDate) AS latestDate, COUNT(*) AS value
      FROM FundMoneyDaily
      WHERE tradeDate = (SELECT MAX(tradeDate) FROM FundMoneyDaily)
    `,
    prisma.$queryRaw<Array<{ latestDate: string | null; value: number }>>`
      SELECT MAX(tradeDate) AS latestDate, COUNT(*) AS value
      FROM FundExchangeQuote
      WHERE tradeDate = (SELECT MAX(tradeDate) FROM FundExchangeQuote)
    `,
    prisma.$queryRaw<Array<{ scaleRows: number; holderRows: number }>>`
      SELECT
        (SELECT COUNT(*) FROM FundMarketScale) AS scaleRows,
        (SELECT COUNT(*) FROM FundHolderStructure) AS holderRows
    `,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(*) AS value FROM WealthProduct`,
    prisma.$queryRaw<Array<{ value: number }>>`SELECT COUNT(DISTINCT registerCode) AS value FROM WealthNavDaily`,
    prisma.$queryRaw<Array<{ latestDate: string | null; value: number }>>`
      SELECT MAX(navDate) AS latestDate, COUNT(*) AS value
      FROM WealthNavDaily
      WHERE navDate = (SELECT MAX(navDate) FROM WealthNavDaily)
    `
  ]));

  const fundTotal = toCount(fundTotalRows[0]?.value);
  const wealthTotal = toCount(wealthTotalRows[0]?.value);
  const dividendFundCount = toCount(dividendRows[0]?.value);
  const announcementFundCount = toCount(announcementRows[0]?.value);
  const ratingFundCount = toCount(ratingRows[0]?.value);

  const metrics = [
    coverageMetric({
      key: "fund_nav_latest",
      label: "基金最新净值",
      value: toCount(fundNavLatestRows[0]?.value),
      total: fundTotal,
      latestDate: fundNavLatestRows[0]?.latestDate,
      note: "每日涨跌、单位净值、累计净值"
    }),
    coverageMetric({
      key: "fund_history_14",
      label: "基金 14 日历史",
      value: toCount(fundHistory14Rows[0]?.value),
      total: fundTotal,
      note: "用于曲线、回撤、波动率计算"
    }),
    coverageMetric({
      key: "fund_rank",
      label: "多维收益排行",
      value: toCount(rankLatestRows[0]?.funds),
      total: fundTotal,
      latestDate: rankLatestRows[0]?.latestDate,
      note: `${toCount(rankLatestRows[0]?.value).toLocaleString("zh-CN")} 条区间收益记录`
    }),
    coverageMetric({
      key: "fund_profile",
      label: "基金画像",
      value: toCount(profileRows[0]?.value),
      total: fundTotal,
      note: "基金公司、经理、规模、投资目标"
    }),
    coverageMetric({
      key: "fund_fee",
      label: "费率信息",
      value: toCount(feeRows[0]?.value),
      total: fundTotal,
      note: "申购、赎回、管理、托管等费用"
    }),
    coverageMetric({
      key: "fund_stock_holding",
      label: "股票持仓",
      value: toCount(stockHoldingRows[0]?.value),
      total: fundTotal,
      note: "定期报告前十大/披露持仓"
    }),
    coverageMetric({
      key: "fund_bond_holding",
      label: "债券持仓",
      value: toCount(bondHoldingRows[0]?.value),
      total: fundTotal,
      note: "债券型产品覆盖更有意义",
      goodAt: 25,
      warnAt: 10
    }),
    coverageMetric({
      key: "fund_industry",
      label: "行业配置",
      value: toCount(industryRows[0]?.value),
      total: fundTotal,
      note: "股票/混合/指数基金行业暴露"
    }),
    coverageMetric({
      key: "fund_portfolio_change",
      label: "买入卖出明细",
      value: toCount(portfolioChangeRows[0]?.value),
      total: fundTotal,
      note: "报告期累计买卖股票"
    }),
    coverageMetric({
      key: "fund_rating",
      label: "基金评级",
      value: ratingFundCount,
      total: fundTotal,
      note: `${toCount(ratingRows[0]?.rows).toLocaleString("zh-CN")} 条评级记录`,
      goodAt: 60,
      warnAt: 30
    }),
    coverageMetric({
      key: "fund_dividend",
      label: "分红配送",
      value: dividendFundCount,
      total: null,
      note: `${toCount(dividendRows[0]?.rows).toLocaleString("zh-CN")} 条历史分红，未分红基金不会有记录`
    }),
    coverageMetric({
      key: "fund_announcement",
      label: "基金公告",
      value: announcementFundCount,
      total: fundTotal,
      note: `${toCount(announcementRows[0]?.rows).toLocaleString("zh-CN")} 条公告/报告链接`
    }),
    coverageMetric({
      key: "money_fund",
      label: "货币基金",
      value: toCount(moneyLatestRows[0]?.value),
      total: null,
      latestDate: moneyLatestRows[0]?.latestDate,
      note: "万份收益、7 日年化"
    }),
    coverageMetric({
      key: "exchange_fund",
      label: "场内基金",
      value: toCount(exchangeLatestRows[0]?.value),
      total: null,
      latestDate: exchangeLatestRows[0]?.latestDate,
      note: "ETF/LOF 行情、折溢价"
    }),
    coverageMetric({
      key: "market_stats",
      label: "市场结构",
      value: toCount(marketScaleRows[0]?.scaleRows) + toCount(marketScaleRows[0]?.holderRows),
      total: null,
      note: "规模变动和持有人结构"
    }),
    coverageMetric({
      key: "wealth_nav",
      label: "银行理财公开样本",
      value: toCount(wealthNavFundsRows[0]?.value),
      total: wealthTotal,
      latestDate: wealthLatestRows[0]?.latestDate,
      note: `${toCount(wealthLatestRows[0]?.value).toLocaleString("zh-CN")} 条最新净值；非全市场授权数据`
    })
  ];

  const recommendations = [
    "白天边看页面边补数，建议运行 python scripts/collector/run_backfill.py --profile-limit 200 --history-limit 200。",
    "夜间或不用页面时再运行 python scripts/collector/run_backfill.py --full；该任务会按缺失优先级续跑，但全量基金画像预计耗时很长。",
    "银行理财公开源只能抓到可见样本；若要全市场，需要接入普益标准、Wind、Choice、iFinD 或用 WEALTH_PRODUCTS_JSON 导入授权数据。"
  ];

  return {
    fundTotal,
    wealthTotal,
    fundWithAnyNav: toCount(fundNavFundsRows[0]?.value),
    metrics,
    recommendations
  };
}

export async function getSummary() {
  const [fundCount, wealthCount, latestSync, latestFundRows, latestWealthRows] =
    await Promise.all([
      prisma.fund.count(),
      prisma.wealthProduct.count(),
      getLatestSyncJob(),
      prisma.$queryRaw<Array<{ positive: number; negative: number; flat: number }>>`
        SELECT
          SUM(CASE WHEN latest.dailyGrowthRate > 0 THEN 1 ELSE 0 END) AS positive,
          SUM(CASE WHEN latest.dailyGrowthRate < 0 THEN 1 ELSE 0 END) AS negative,
          SUM(CASE WHEN latest.dailyGrowthRate = 0 THEN 1 ELSE 0 END) AS flat
        FROM Fund f
        LEFT JOIN FundNavDaily latest
          ON latest.id = (
            SELECT id FROM FundNavDaily nav
            WHERE nav.fundCode = f.code
            ORDER BY nav.tradeDate DESC
            LIMIT 1
          )
      `,
      prisma.$queryRaw<Array<{ updated: number }>>`
        SELECT COUNT(*) AS updated
        FROM WealthProduct p
        JOIN WealthNavDaily latest
          ON latest.id = (
            SELECT id FROM WealthNavDaily nav
            WHERE nav.registerCode = p.registerCode
            ORDER BY nav.navDate DESC
            LIMIT 1
          )
      `
    ]);

  const [topGainers, topLosers] = await Promise.all([
    getFundList({ page: 1, pageSize: 5, sort: "growth_desc" }),
    getFundList({ page: 1, pageSize: 5, sort: "growth_asc" })
  ]);

  const distribution = latestFundRows[0] ?? { positive: 0, negative: 0, flat: 0 };

  return {
    fundCount,
    wealthCount,
    wealthUpdatedCount: Number(latestWealthRows[0]?.updated ?? 0),
    fundDistribution: {
      positive: Number(distribution.positive ?? 0),
      negative: Number(distribution.negative ?? 0),
      flat: Number(distribution.flat ?? 0)
    },
    latestSync,
    topGainers: topGainers.items,
    topLosers: topLosers.items
  };
}

export async function getFundList(params: {
  q?: string | null;
  type?: string | null;
  direction?: string | null;
  purchaseStatus?: string | null;
  minRate?: string | number | null;
  maxRate?: string | number | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}): Promise<PagedResult<FundListItem>> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const offset = (page - 1) * pageSize;
  const filters: Prisma.Sql[] = [];

  if (params.q) {
    const pattern = `%${params.q.trim()}%`;
    filters.push(Prisma.sql`(f.code LIKE ${pattern} OR f.name LIKE ${pattern} OR f.pinyin LIKE ${pattern})`);
  }

  if (params.type) {
    filters.push(Prisma.sql`f.fundType = ${params.type}`);
  }

  if (params.purchaseStatus) {
    const pattern = `%${params.purchaseStatus.trim()}%`;
    filters.push(Prisma.sql`f.purchaseStatus LIKE ${pattern}`);
  }

  if (params.direction === "up") {
    filters.push(Prisma.sql`latest.dailyGrowthRate > 0`);
  } else if (params.direction === "down") {
    filters.push(Prisma.sql`latest.dailyGrowthRate < 0`);
  } else if (params.direction === "flat") {
    filters.push(Prisma.sql`latest.dailyGrowthRate = 0`);
  }

  const minRate = params.minRate !== undefined && params.minRate !== null ? Number(params.minRate) : NaN;
  const maxRate = params.maxRate !== undefined && params.maxRate !== null ? Number(params.maxRate) : NaN;

  if (Number.isFinite(minRate)) {
    filters.push(Prisma.sql`latest.dailyGrowthRate >= ${minRate}`);
  }

  if (Number.isFinite(maxRate)) {
    filters.push(Prisma.sql`latest.dailyGrowthRate <= ${maxRate}`);
  }

  const whereSql = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const orderSql =
    params.sort === "growth_asc"
      ? Prisma.sql`latest.dailyGrowthRate ASC NULLS LAST, f.code ASC`
      : params.sort === "name"
        ? Prisma.sql`f.name ASC, f.code ASC`
        : Prisma.sql`latest.dailyGrowthRate DESC NULLS LAST, f.code ASC`;

  const rows = await prisma.$queryRaw<FundListItem[]>`
    SELECT
      f.code,
      f.name,
      f.fundType,
      f.purchaseStatus,
      f.redeemStatus,
      latest.tradeDate,
      latest.unitNav,
      latest.accumulatedNav,
      latest.dailyGrowthValue,
      latest.dailyGrowthRate,
      latest.growthRateSource,
      CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS watched
    FROM Fund f
    LEFT JOIN FundNavDaily latest
      ON latest.id = (
        SELECT id FROM FundNavDaily nav
        WHERE nav.fundCode = f.code
        ORDER BY nav.tradeDate DESC
        LIMIT 1
      )
    LEFT JOIN Watchlist w
      ON w.targetType = 'fund' AND w.fundCode = f.code
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;

  const items = rows.map((row) => ({
    ...row,
    watched: Boolean(Number(row.watched))
  }));

  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*) AS total
    FROM Fund f
    LEFT JOIN FundNavDaily latest
      ON latest.id = (
        SELECT id FROM FundNavDaily nav
        WHERE nav.fundCode = f.code
        ORDER BY nav.tradeDate DESC
        LIMIT 1
      )
    ${whereSql}
  `;

  const total = Number(totalRows[0]?.total ?? 0);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function getFundDetail(code: string) {
  const fund = await prisma.fund.findUnique({
    where: { code },
    include: {
      profile: true,
      ratings: {
        orderBy: [{ fiveStarCount: "desc" }, { morningstar: "desc" }],
        take: 1
      },
      fees: {
        orderBy: [{ feeType: "asc" }, { id: "asc" }],
        take: 20
      },
      dividends: {
        orderBy: [{ registrationDate: "desc" }, { paymentDate: "desc" }, { createdAt: "desc" }],
        take: 12
      },
      navs: {
        orderBy: { tradeDate: "desc" },
        take: 380
      },
      announcements: {
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 20
      },
      watchlistEntries: {
        take: 1
      }
    }
  });

  if (!fund) {
    return null;
  }

  const periodReturnRows = await prisma.fundRankDaily.findMany({
    where: {
      fundCode: code,
      rangeKey: {
        in: FUND_DETAIL_RETURN_RANGES.map((item) => item.key)
      }
    },
    orderBy: [{ rankDate: "desc" }, { createdAt: "desc" }]
  });
  const latestReturnByRange = new Map<string, (typeof periodReturnRows)[number]>();
  for (const row of periodReturnRows) {
    if (!latestReturnByRange.has(row.rangeKey)) {
      latestReturnByRange.set(row.rangeKey, row);
    }
  }
  const periodReturns = FUND_DETAIL_RETURN_RANGES.map((range) => {
    const row = latestReturnByRange.get(range.key);
    return {
      rangeKey: range.key,
      label: range.label,
      rankValue: row?.rankValue ?? null,
      rankDate: row?.rankDate ?? null
    };
  });
  const orderedNavs = [...fund.navs].reverse();
  const riskMetrics = calculateRiskMetrics(orderedNavs);
  const latestNav = orderedNavs.at(-1);
  const warnings: AlertItem[] = [];
  if (latestNav?.dailyGrowthRate !== null && latestNav?.dailyGrowthRate !== undefined && latestNav.dailyGrowthRate <= -3) {
    warnings.push({
      level: "high",
      targetType: "fund",
      targetKey: fund.code,
      title: "单日跌幅较大",
      message: `最新日增长率为 ${latestNav.dailyGrowthRate.toFixed(2)}%。`,
      metric: "daily_drop"
    });
  }
  if (riskMetrics.maxDrawdown !== null && riskMetrics.maxDrawdown <= -10) {
    warnings.push({
      level: "medium",
      targetType: "fund",
      targetKey: fund.code,
      title: "近一年回撤较高",
      message: `样本区间最大回撤约 ${riskMetrics.maxDrawdown.toFixed(2)}%。`,
      metric: "max_drawdown"
    });
  }
  const scaleYi = parseScaleYi(fund.profile?.latestScale);
  if (scaleYi !== null && scaleYi < 0.5) {
    warnings.push({
      level: "medium",
      targetType: "fund",
      targetKey: fund.code,
      title: "基金规模偏小",
      message: `最新披露规模约 ${scaleYi.toFixed(2)} 亿元。`,
      metric: "scale_low"
    });
  }
  if (fund.announcements.some((item) => item.source.includes("personnel"))) {
    warnings.push({
      level: "low",
      targetType: "fund",
      targetKey: fund.code,
      title: "近期有人事公告",
      message: "详情页公告中包含基金经理或人员变动相关披露。",
      metric: "personnel_announcement"
    });
  }

  return {
    ...fund,
    navs: orderedNavs,
    periodReturns,
    riskMetrics,
    latestRating: fund.ratings[0] ?? null,
    warnings,
    watched: fund.watchlistEntries.length > 0
  };
}

export async function getFundNavHistory(
  code: string,
  params: {
    page?: string | number | null;
    pageSize?: string | number | null;
  }
) {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const [fund, total, navs] = await Promise.all([
    prisma.fund.findUnique({
      where: { code }
    }),
    prisma.fundNavDaily.count({
      where: { fundCode: code }
    }),
    prisma.fundNavDaily.findMany({
      where: { fundCode: code },
      orderBy: { tradeDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  if (!fund) {
    return null;
  }

  return {
    fund,
    items: navs,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function getFundAllNavs(code: string) {
  const fund = await prisma.fund.findUnique({
    where: { code }
  });

  if (!fund) {
    return null;
  }

  const navs = await prisma.fundNavDaily.findMany({
    where: { fundCode: code },
    orderBy: { tradeDate: "desc" }
  });

  return { fund, navs };
}

export async function getFundRankings(params: {
  rangeKey?: string | null;
  direction?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}): Promise<PagedResult<FundRankingItem> & { latestRankDate: string | null; rangeKeys: string[] }> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const rangeKey = params.rangeKey || "daily_growth_rate";
  const latestRows = await prisma.$queryRaw<Array<{ latestRankDate: string | null }>>`
    SELECT MAX(rankDate) AS latestRankDate
    FROM FundRankDaily
    WHERE rangeKey = ${rangeKey}
      AND rankDate LIKE '20%'
  `;
  const latestRankDate = latestRows[0]?.latestRankDate ?? null;
  const rangeKeyRows = await prisma.fundRankDaily.findMany({
    distinct: ["rangeKey"],
    select: { rangeKey: true },
    orderBy: { rangeKey: "asc" }
  });

  if (!latestRankDate) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      pageCount: 1,
      latestRankDate: null,
      rangeKeys: rangeKeyRows.map((row) => row.rangeKey)
    };
  }

  const orderSql =
    params.direction === "asc"
      ? Prisma.sql`r.rankValue ASC NULLS LAST, r.fundCode ASC`
      : Prisma.sql`r.rankValue DESC NULLS LAST, r.fundCode ASC`;

  const rows = await prisma.$queryRaw<FundRankingItem[]>`
    SELECT
      r.fundCode,
      f.name,
      f.fundType,
      r.rankDate,
      r.rangeKey,
      r.rankValue,
      nav.unitNav,
      nav.dailyGrowthRate
    FROM FundRankDaily r
    JOIN Fund f ON f.code = r.fundCode
    LEFT JOIN FundNavDaily nav
      ON nav.id = (
        SELECT id FROM FundNavDaily latest
        WHERE latest.fundCode = r.fundCode
        ORDER BY latest.tradeDate DESC
        LIMIT 1
      )
    WHERE r.rangeKey = ${rangeKey}
      AND r.rankDate = ${latestRankDate}
      AND r.rankDate LIKE '20%'
    ORDER BY ${orderSql}
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `;
  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*) AS total
    FROM FundRankDaily
    WHERE rangeKey = ${rangeKey}
      AND rankDate = ${latestRankDate}
      AND rankDate LIKE '20%'
  `;
  const total = Number(totalRows[0]?.total ?? 0);

  return {
    items: rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    latestRankDate,
    rangeKeys: rangeKeyRows.map((row) => row.rangeKey)
  };
}

export async function getFundProfile(code: string) {
  const fund = await prisma.fund.findUnique({
    where: { code },
    include: {
      profile: true,
      fees: {
        orderBy: [{ feeType: "asc" }, { id: "asc" }]
      },
      bondHoldings: {
        orderBy: [{ reportPeriod: "desc" }, { ratio: "desc" }],
        take: 80
      },
      portfolioChanges: {
        orderBy: [{ reportYear: "desc" }, { changeType: "asc" }, { amount: "desc" }],
        take: 120
      },
      holdings: {
        orderBy: [{ reportPeriod: "desc" }, { ratio: "desc" }],
        take: 80
      },
      industries: {
        orderBy: [{ reportDate: "desc" }, { ratio: "desc" }],
        take: 80
      },
      announcements: {
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 20
      }
    }
  });

  return fund;
}

export async function getMoneyFunds(params: {
  q?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
  sort?: string | null;
}): Promise<PagedResult<MoneyFundItem>> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const filters: Prisma.Sql[] = [];
  if (params.q) {
    const pattern = `%${params.q.trim()}%`;
    filters.push(Prisma.sql`(fundCode LIKE ${pattern} OR fundName LIKE ${pattern})`);
  }
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const orderSql =
    params.sort === "income"
      ? Prisma.sql`tenThousandIncome DESC NULLS LAST, fundCode ASC`
      : Prisma.sql`sevenDayAnnualized DESC NULLS LAST, fundCode ASC`;
  const latestRows = await prisma.$queryRaw<Array<{ latestDate: string | null }>>`
    SELECT MAX(tradeDate) AS latestDate FROM FundMoneyDaily
  `;
  const latestDate = latestRows[0]?.latestDate;
  const latestFilter = latestDate ? Prisma.sql`tradeDate = ${latestDate}` : Prisma.sql`1 = 0`;
  const rows = await prisma.$queryRaw<MoneyFundItem[]>`
    SELECT fundCode, fundName, tradeDate, tenThousandIncome, sevenDayAnnualized,
           dailyGrowthRate, managerNames, purchaseStatus
    FROM FundMoneyDaily
    WHERE ${latestFilter}
    ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
    ORDER BY ${orderSql}
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `;
  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*) AS total FROM FundMoneyDaily
    WHERE ${latestFilter}
    ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
  `;
  const total = Number(totalRows[0]?.total ?? 0);
  return { items: rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getExchangeFunds(params: {
  q?: string | null;
  exchangeType?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}): Promise<PagedResult<ExchangeFundItem>> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const filters: Prisma.Sql[] = [];
  if (params.q) {
    const pattern = `%${params.q.trim()}%`;
    filters.push(Prisma.sql`(fundCode LIKE ${pattern} OR fundName LIKE ${pattern})`);
  }
  if (params.exchangeType) {
    filters.push(Prisma.sql`exchangeType = ${params.exchangeType}`);
  }
  const latestRows = await prisma.$queryRaw<Array<{ latestDate: string | null }>>`
    SELECT MAX(tradeDate) AS latestDate FROM FundExchangeQuote
  `;
  const latestDate = latestRows[0]?.latestDate;
  const latestFilter = latestDate ? Prisma.sql`tradeDate = ${latestDate}` : Prisma.sql`1 = 0`;
  const rows = await prisma.$queryRaw<ExchangeFundItem[]>`
    SELECT fundCode, fundName, exchangeType, tradeDate, latestPrice, changeValue,
           changeRate, discountRate, amount, totalMarketValue
    FROM FundExchangeQuote
    WHERE ${latestFilter}
    ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
    ORDER BY changeRate DESC NULLS LAST, fundCode ASC
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `;
  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*) AS total FROM FundExchangeQuote
    WHERE ${latestFilter}
    ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
  `;
  const total = Number(totalRows[0]?.total ?? 0);
  return { items: rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getFundMarketStats() {
  const [scales, holders] = await Promise.all([
    prisma.fundMarketScale.findMany({ orderBy: { reportDate: "desc" }, take: 24 }),
    prisma.fundHolderStructure.findMany({ orderBy: { reportDate: "desc" }, take: 24 })
  ]);
  return { scales, holders };
}

export async function getFundRatings(params: {
  q?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}) {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const where = params.q
    ? {
        OR: [
          { fundCode: { contains: params.q } },
          { fundName: { contains: params.q } },
          { fundCompany: { contains: params.q } }
        ]
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.fundRating.findMany({
      where,
      orderBy: [{ fiveStarCount: "desc" }, { morningstar: "desc" }, { fundCode: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.fundRating.count({ where })
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getFundManagers(params: {
  q?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}) {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const where = params.q
    ? {
        OR: [
          { managerName: { contains: params.q } },
          { fundCompany: { contains: params.q } }
        ]
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.fundManager.findMany({
      where,
      orderBy: [{ currentFundNum: "desc" }, { managerName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.fundManager.count({ where })
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getWealthProductList(params: {
  q?: string | null;
  issuer?: string | null;
  riskLevel?: string | null;
  operationMode?: string | null;
  direction?: string | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}): Promise<PagedResult<WealthListItem>> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const offset = (page - 1) * pageSize;
  const filters: Prisma.Sql[] = [];

  if (params.q) {
    const pattern = `%${params.q.trim()}%`;
    filters.push(Prisma.sql`(p.registerCode LIKE ${pattern} OR p.name LIKE ${pattern})`);
  }

  if (params.issuer) {
    const pattern = `%${params.issuer.trim()}%`;
    filters.push(Prisma.sql`p.issuer LIKE ${pattern}`);
  }

  if (params.riskLevel) {
    filters.push(Prisma.sql`p.riskLevel = ${params.riskLevel}`);
  }

  if (params.operationMode) {
    filters.push(Prisma.sql`p.operationMode = ${params.operationMode}`);
  }

  if (params.direction === "up") {
    filters.push(Prisma.sql`latest.dailyChangeRate > 0`);
  } else if (params.direction === "down") {
    filters.push(Prisma.sql`latest.dailyChangeRate < 0`);
  } else if (params.direction === "flat") {
    filters.push(Prisma.sql`latest.dailyChangeRate = 0`);
  }

  const whereSql = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const orderSql =
    params.sort === "change_asc"
      ? Prisma.sql`latest.dailyChangeRate ASC NULLS LAST, p.registerCode ASC`
      : params.sort === "name"
        ? Prisma.sql`p.name ASC, p.registerCode ASC`
        : Prisma.sql`latest.navDate DESC NULLS LAST, latest.dailyChangeRate DESC NULLS LAST, p.registerCode ASC`;

  const rows = await prisma.$queryRaw<WealthListItem[]>`
    SELECT
      p.registerCode,
      p.name,
      p.issuer,
      p.riskLevel,
      p.operationMode,
      p.productType,
      p.saleStatus,
      p.latestDisclosureAt,
      p.sourceUrl,
      latest.navDate,
      latest.netValue,
      latest.accumulatedValue,
      latest.dailyChange,
      latest.dailyChangeRate,
      CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS watched
    FROM WealthProduct p
    LEFT JOIN WealthNavDaily latest
      ON latest.id = (
        SELECT id FROM WealthNavDaily nav
        WHERE nav.registerCode = p.registerCode
        ORDER BY nav.navDate DESC
        LIMIT 1
      )
    LEFT JOIN Watchlist w
      ON w.targetType = 'wealth' AND w.registerCode = p.registerCode
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;

  const items = rows.map((row) => ({
    ...row,
    watched: Boolean(Number(row.watched))
  }));

  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*) AS total
    FROM WealthProduct p
    LEFT JOIN WealthNavDaily latest
      ON latest.id = (
        SELECT id FROM WealthNavDaily nav
        WHERE nav.registerCode = p.registerCode
        ORDER BY nav.navDate DESC
        LIMIT 1
      )
    ${whereSql}
  `;

  const total = Number(totalRows[0]?.total ?? 0);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function getWealthProductDetail(registerCode: string) {
  const product = await prisma.wealthProduct.findUnique({
    where: { registerCode },
    include: {
      navs: {
        orderBy: { navDate: "desc" },
        take: 380
      },
      announcements: {
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 20
      },
      watchlistEntries: {
        take: 1
      }
    }
  });

  if (!product) {
    return null;
  }
  const orderedNavs = [...product.navs].reverse();
  const latest = orderedNavs.at(-1);
  const periodReturns = [
    { label: "近1月", value: periodChange(orderedNavs, 30) },
    { label: "近3月", value: periodChange(orderedNavs, 90) },
    { label: "近6月", value: periodChange(orderedNavs, 180) }
  ];
  const warnings: AlertItem[] = [];
  const latestDate = toDate(latest?.navDate);
  const staleDays = latestDate ? daysBetween(latestDate, new Date()) : null;
  if (staleDays !== null && staleDays > 3) {
    warnings.push({
      level: "medium",
      targetType: "wealth",
      targetKey: product.registerCode,
      title: "净值披露可能滞后",
      message: `最新净值日期距离今天约 ${staleDays} 天。`,
      metric: "wealth_nav_stale"
    });
  }
  if (latest?.netValue !== null && latest?.netValue !== undefined && latest.netValue < 1) {
    warnings.push({
      level: "high",
      targetType: "wealth",
      targetKey: product.registerCode,
      title: "产品净值低于 1",
      message: `最新净值为 ${latest.netValue.toFixed(4)}。`,
      metric: "wealth_below_par"
    });
  }
  if (product.riskLevel && ["R4", "R5"].includes(product.riskLevel.toUpperCase())) {
    warnings.push({
      level: "medium",
      targetType: "wealth",
      targetKey: product.registerCode,
      title: "风险等级较高",
      message: `披露风险等级为 ${product.riskLevel}。`,
      metric: "wealth_risk_level"
    });
  }

  return {
    ...product,
    navs: orderedNavs,
    periodReturns,
    warnings,
    watched: product.watchlistEntries.length > 0
  };
}

export async function toggleWatchlist(input: {
  targetType: "fund" | "wealth";
  code: string;
  watched: boolean;
}) {
  if (input.targetType === "fund") {
    if (input.watched) {
      await prisma.watchlist.upsert({
        where: {
          targetType_targetKey: {
            targetType: "fund",
            targetKey: input.code
          }
        },
        update: {},
        create: {
          targetType: "fund",
          targetKey: input.code,
          fundCode: input.code
        }
      });
      return { watched: true };
    }

    await prisma.watchlist.deleteMany({
      where: {
        targetType: "fund",
        targetKey: input.code,
        fundCode: input.code
      }
    });
    return { watched: false };
  }

  if (input.watched) {
    await prisma.watchlist.upsert({
      where: {
        targetType_targetKey: {
          targetType: "wealth",
          targetKey: input.code
        }
      },
      update: {},
      create: {
        targetType: "wealth",
        targetKey: input.code,
        registerCode: input.code
      }
    });
    return { watched: true };
  }

  await prisma.watchlist.deleteMany({
    where: {
      targetType: "wealth",
      targetKey: input.code,
      registerCode: input.code
    }
  });

  return { watched: false };
}

export async function getPortfolioDashboard() {
  const holdings = await prisma.portfolioHolding.findMany({
    orderBy: [{ targetType: "asc" }, { updatedAt: "desc" }],
    include: {
      fund: {
        include: {
          navs: { orderBy: { tradeDate: "desc" }, take: 2 }
        }
      },
      product: {
        include: {
          navs: { orderBy: { navDate: "desc" }, take: 2 }
        }
      }
    }
  });

  const items = holdings.map((holding) => {
    const latestFundNav = holding.fund?.navs[0];
    const previousFundNav = holding.fund?.navs[1];
    const latestWealthNav = holding.product?.navs[0];
    const previousWealthNav = holding.product?.navs[1];
    const latestPrice = latestFundNav?.unitNav ?? latestWealthNav?.netValue ?? null;
    const previousPrice = previousFundNav?.unitNav ?? previousWealthNav?.netValue ?? null;
    const shares =
      holding.shares ??
      (holding.costAmount && holding.costPrice && holding.costPrice > 0 ? holding.costAmount / holding.costPrice : null);
    const currentValue = shares && latestPrice ? shares * latestPrice : holding.costAmount;
    const profit = currentValue !== null && holding.costAmount !== null ? currentValue - holding.costAmount : null;
    const profitRate = profit !== null && holding.costAmount && holding.costAmount > 0 ? (profit / holding.costAmount) * 100 : null;
    const dailyProfit = shares && latestPrice && previousPrice ? shares * (latestPrice - previousPrice) : null;
    const dailyRate =
      latestFundNav?.dailyGrowthRate ??
      latestWealthNav?.dailyChangeRate ??
      (latestPrice && previousPrice ? (latestPrice / previousPrice - 1) * 100 : null);
    return {
      id: holding.id,
      targetType: holding.targetType,
      targetKey: holding.targetKey,
      name: holding.displayName ?? holding.fund?.name ?? holding.product?.name ?? holding.targetKey,
      issuer: holding.product?.issuer ?? holding.fund?.fundType ?? null,
      shares,
      costAmount: holding.costAmount,
      costPrice: holding.costPrice,
      latestPrice,
      currentValue,
      profit,
      profitRate,
      dailyProfit,
      dailyRate,
      priceDate: latestFundNav?.tradeDate ?? latestWealthNav?.navDate ?? null,
      note: holding.note
    };
  });

  const summary = items.reduce(
    (acc, item) => {
      acc.costAmount += item.costAmount ?? 0;
      acc.currentValue += item.currentValue ?? 0;
      acc.profit += item.profit ?? 0;
      acc.dailyProfit += item.dailyProfit ?? 0;
      return acc;
    },
    { costAmount: 0, currentValue: 0, profit: 0, dailyProfit: 0 }
  );
  const profitRate = summary.costAmount > 0 ? (summary.profit / summary.costAmount) * 100 : null;
  return { items, summary: { ...summary, profitRate } };
}

export async function savePortfolioHolding(input: {
  targetType: "fund" | "wealth";
  targetKey: string;
  shares?: number | null;
  costAmount?: number | null;
  costPrice?: number | null;
  purchaseDate?: string | null;
  note?: string | null;
}) {
  const targetKey = input.targetKey.trim();
  if (!targetKey) {
    throw new Error("targetKey is required");
  }

  const fund = input.targetType === "fund" ? await prisma.fund.findUnique({ where: { code: targetKey } }) : null;
  const product =
    input.targetType === "wealth" ? await prisma.wealthProduct.findUnique({ where: { registerCode: targetKey } }) : null;
  if (input.targetType === "fund" && !fund) {
    throw new Error("基金代码不存在");
  }
  if (input.targetType === "wealth" && !product) {
    throw new Error("理财登记编码不存在");
  }

  return prisma.portfolioHolding.upsert({
    where: {
      targetType_targetKey: {
        targetType: input.targetType,
        targetKey
      }
    },
    update: {
      displayName: fund?.name ?? product?.name ?? null,
      shares: input.shares ?? null,
      costAmount: input.costAmount ?? null,
      costPrice: input.costPrice ?? null,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
      note: input.note ?? null
    },
    create: {
      targetType: input.targetType,
      targetKey,
      fundCode: input.targetType === "fund" ? targetKey : null,
      registerCode: input.targetType === "wealth" ? targetKey : null,
      displayName: fund?.name ?? product?.name ?? null,
      shares: input.shares ?? null,
      costAmount: input.costAmount ?? null,
      costPrice: input.costPrice ?? null,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
      note: input.note ?? null
    }
  });
}

export async function deletePortfolioHolding(id: number) {
  await prisma.portfolioHolding.deleteMany({ where: { id } });
  return { deleted: true };
}

export async function getFundAnnouncements(params: {
  q?: string | null;
  source?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}) {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const source =
    params.source === "report"
      ? "akshare-report"
      : params.source === "dividend"
        ? "akshare-dividend"
        : params.source === "personnel"
          ? "akshare-personnel"
          : null;
  const where = {
    targetType: "fund",
    ...(source ? { source } : {}),
    ...(params.q
      ? {
          OR: [
            { title: { contains: params.q } },
            { fundCode: { contains: params.q } },
            { fund: { name: { contains: params.q } } }
          ]
        }
      : {})
  };
  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: { fund: { select: { name: true } } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.announcement.count({ where })
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getFundDividends(params: {
  q?: string | null;
  dividendType?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}) {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const where = {
    ...(params.dividendType ? { dividendType: params.dividendType } : {}),
    ...(params.q
      ? {
          OR: [
            { fundCode: { contains: params.q } },
            { fundName: { contains: params.q } },
            { fund: { name: { contains: params.q } } }
          ]
        }
      : {})
  };
  const [items, total] = await Promise.all([
    prisma.fundDividend.findMany({
      where,
      include: { fund: { select: { name: true } } },
      orderBy: [{ registrationDate: "desc" }, { paymentDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.fundDividend.count({ where })
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getComparisonData(targets: string[]) {
  const normalized = targets
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => {
      if (item.startsWith("fund:") || item.startsWith("wealth:")) {
        const [targetType, targetKey] = item.split(":");
        return { targetType, targetKey };
      }
      return /^[0-9]{6}$/.test(item) ? { targetType: "fund", targetKey: item } : { targetType: "wealth", targetKey: item };
    });

  const items = [];
  for (const target of normalized) {
    if (target.targetType === "fund") {
      const detail = await getFundDetail(target.targetKey);
      if (!detail) {
        continue;
      }
      const latest = detail.navs.at(-1);
      items.push({
        targetType: "fund",
        targetKey: detail.code,
        name: detail.name,
        latestDate: latest?.tradeDate ?? null,
        latestValue: latest?.unitNav ?? null,
        dailyRate: latest?.dailyGrowthRate ?? null,
        riskLevel: detail.fundType,
        manager: detail.profile?.managerNames ?? null,
        scale: detail.profile?.latestScale ?? null,
        periodReturns: detail.periodReturns,
        maxDrawdown: detail.riskMetrics.maxDrawdown,
        volatility: detail.riskMetrics.volatility,
        fee: detail.fees[0]?.feeValue ?? null
      });
    } else {
      const detail = await getWealthProductDetail(target.targetKey);
      if (!detail) {
        continue;
      }
      const latest = detail.navs.at(-1);
      items.push({
        targetType: "wealth",
        targetKey: detail.registerCode,
        name: detail.name,
        latestDate: latest?.navDate ?? null,
        latestValue: latest?.netValue ?? null,
        dailyRate: latest?.dailyChangeRate ?? null,
        riskLevel: detail.riskLevel,
        manager: detail.managerName ?? detail.issuer ?? null,
        scale: detail.investmentTerm ?? null,
        periodReturns: detail.periodReturns,
        maxDrawdown: null,
        volatility: null,
        fee: detail.feeSummary
      });
    }
  }

  return { items };
}

export async function getAlertCenter() {
  const watched = await prisma.watchlist.findMany({ take: 80 });
  const holdings = await prisma.portfolioHolding.findMany({ take: 80 });
  const fundCodes = Array.from(
    new Set([
      ...watched.map((item) => item.fundCode).filter(Boolean),
      ...holdings.map((item) => item.fundCode).filter(Boolean)
    ] as string[])
  ).slice(0, 50);
  const wealthCodes = Array.from(
    new Set([
      ...watched.map((item) => item.registerCode).filter(Boolean),
      ...holdings.map((item) => item.registerCode).filter(Boolean)
    ] as string[])
  ).slice(0, 50);

  const alerts: AlertItem[] = [];
  for (const code of fundCodes) {
    const detail = await getFundDetail(code);
    if (detail) {
      alerts.push(...detail.warnings);
    }
  }
  for (const code of wealthCodes) {
    const detail = await getWealthProductDetail(code);
    if (detail) {
      alerts.push(...detail.warnings);
    }
  }

  if (alerts.length === 0) {
    const [fundLosers, staleWealth] = await Promise.all([
      getFundList({ page: 1, pageSize: 5, sort: "growth_asc" }),
      prisma.wealthProduct.findMany({
        include: { navs: { orderBy: { navDate: "desc" }, take: 1 } },
        take: 5
      })
    ]);
    for (const item of fundLosers.items) {
      if (item.dailyGrowthRate !== null && item.dailyGrowthRate !== undefined && item.dailyGrowthRate < 0) {
        alerts.push({
          level: item.dailyGrowthRate <= -3 ? "high" : "low",
          targetType: "fund",
          targetKey: item.code,
          title: "全市场跌幅提醒",
          message: `${item.name} 最新日增长率为 ${item.dailyGrowthRate.toFixed(2)}%。`,
          metric: "market_fund_drop"
        });
      }
    }
    for (const product of staleWealth) {
      const latest = product.navs[0];
      const staleDays = daysBetween(latest?.navDate, new Date());
      if (staleDays !== null && staleDays > 3) {
        alerts.push({
          level: "medium",
          targetType: "wealth",
          targetKey: product.registerCode,
          title: "理财净值披露滞后",
          message: `${product.name} 最新净值日期距离今天约 ${staleDays} 天。`,
          metric: "wealth_nav_stale"
        });
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return { items: alerts.sort((a, b) => order[a.level] - order[b.level]) };
}
