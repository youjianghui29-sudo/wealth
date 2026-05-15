import { Prisma } from "@prisma/client";
import { buildFundDataCoverage } from "@/lib/data-quality";
import { classifyFund, fundTypeFilterSqlHint } from "@/lib/fund-classification";
import {
  assignCandidateTiers,
  buildHoldingReconciliation,
  buildDailyHighlights,
  buildDashboardSnapshotState,
  buildCashLedgerSummary,
  buildTransactionSignature,
  buildRebalancePlan,
  buildDecisionReviewState,
  buildSyncJobState,
  chooseAlternativeFunds,
  estimateKnownFeeCost,
  evaluateAdvancedAlertRule,
  evaluateUserAlertRule,
  isSnapshotFresh,
  summarizeDataSourceHealth,
  normalizeAlertActionState,
  normalizeInvestmentPreferences,
  normalizeWatchlistStatus,
  parseCompareTargets
} from "@/lib/fund-ux";
import { ensureSqlitePragmas, prisma } from "@/lib/prisma";
import type {
  ExchangeFundItem,
  FundCandidateItem,
  FundCandidateSummary,
  FundListItem,
  FundRankingItem,
  MoneyFundItem,
  PagedResult,
  WealthListItem
} from "@/lib/types";
import type { AlertActionState } from "@/lib/fund-ux";

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
const FUND_LIST_RETURN_RANGES = [
  "week_1",
  "month_1",
  "month_3",
  "month_6",
  "year_1",
  "year_2",
  "year_3",
  "year_to_date",
  "since_inception"
];
const DEFAULT_PORTFOLIO_TARGETS = [
  { targetKey: "fund", label: "基金资产", targetWeight: 60, maxWeight: null, note: "权益/债券/货币基金合计" },
  { targetKey: "wealth", label: "银行理财", targetWeight: 30, maxWeight: null, note: "银行理财和固收类产品" },
  { targetKey: "cash", label: "现金留存", targetWeight: 10, maxWeight: null, note: "页面未接入现金账户时按 0 计算" },
  { targetKey: "single_position", label: "单一持仓上限", targetWeight: null, maxWeight: 30, note: "任意单只基金或理财占比" },
  { targetKey: "industry", label: "单一行业上限", targetWeight: null, maxWeight: 35, note: "基金持仓穿透后的行业暴露" }
];

type AlertItem = {
  level: "high" | "medium" | "low";
  targetType: "fund" | "wealth";
  targetKey: string;
  title: string;
  message: string;
  metric: string;
};

type AlertCenterResult = { items: AlertItem[] };

let alertCenterCache: { generatedAt: string; result: AlertCenterResult } | null = null;

type DataCoverageResult = {
  fundTotal: number;
  wealthTotal: number;
  fundWithAnyNav: number;
  metrics: Array<ReturnType<typeof coverageMetric>>;
  recommendations: string[];
};

type SummaryResult = {
  fundCount: number;
  wealthCount: number;
  wealthUpdatedCount: number;
  fundLatestNavDate: string | null;
  fundLatestNavRows: number;
  wealthLatestNavDate: string | null;
  fundDistribution: {
    positive: number;
    negative: number;
    flat: number;
  };
  latestSync: Awaited<ReturnType<typeof getLatestSyncJob>>;
  topGainers: FundListItem[];
  topLosers: FundListItem[];
  dailyHighlights: ReturnType<typeof buildDailyHighlights>;
};

let dataCoverageCache: { generatedAt: string; result: DataCoverageResult } | null = null;
let summaryCache: { generatedAt: string; result: SummaryResult } | null = null;

function classifyAnnouncementImpact(title: string | null | undefined, source: string | null | undefined) {
  const text = `${title ?? ""} ${source ?? ""}`;
  if (/清盘|终止上市|终止基金合同|基金合同终止|基金经理变更|变更基金经理|更换基金经理|离任|暂停申购|暂停赎回|限制大额|大额申购|费率调整|调整费率|降低费率|提高费率/.test(text)) {
    return { level: "high", label: "高影响", reason: "可能影响交易、费率、经理或产品存续" };
  }
  if (/分红|派息|恢复大额|恢复申购|持有人大会|开放申购|开放赎回|暂停大额/.test(text)) {
    return { level: "medium", label: "中影响", reason: "可能影响现金流、开放安排或持有人权益" };
  }
  if (/定期报告|季度报告|中期报告|年度报告|招募说明书|产品资料概要/.test(text)) {
    return { level: "low", label: "低影响", reason: "常规披露，适合复核持仓和规模变化" };
  }
  return { level: "low", label: "低影响", reason: "普通公告" };
}

function toPositiveInt(value: string | number | undefined | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function optionalNumber(value: string | number | undefined | null) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return NaN;
  }
  return Number(value);
}

function clampPageSize(value: string | number | undefined | null) {
  return Math.min(toPositiveInt(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

function fundTypeFilter(type: string) {
  const normalized = fundTypeFilterSqlHint(type);
  if (normalized === "ETF") {
    return Prisma.sql`(f.fundType = 'ETF' OR f.name LIKE '%ETF%')`;
  }
  if (normalized === "LOF") {
    return Prisma.sql`(f.fundType = 'LOF' OR f.name LIKE '%LOF%')`;
  }
  if (normalized === "QDII") {
    return Prisma.sql`(f.fundType = 'QDII' OR f.name LIKE '%QDII%' OR f.name LIKE '%全球%' OR f.name LIKE '%海外%' OR f.name LIKE '%纳斯达克%' OR f.name LIKE '%标普%' OR f.name LIKE '%恒生%')`;
  }
  if (normalized === "FOF") {
    return Prisma.sql`(f.fundType = 'FOF' OR f.name LIKE '%FOF%' OR f.name LIKE '%养老目标%' OR f.name LIKE '%目标日期%')`;
  }
  if (normalized === "REITs") {
    return Prisma.sql`(f.fundType = 'REITs' OR f.name LIKE '%REIT%' OR f.name LIKE '%基础设施%')`;
  }
  if (normalized === "货币型") {
    return Prisma.sql`(f.fundType = '货币型' OR f.name LIKE '%货币%' OR f.name LIKE '%现金%' OR f.name LIKE '%余额%' OR f.name LIKE '%天天%')`;
  }
  if (normalized === "债券型") {
    return Prisma.sql`(f.fundType = '债券型' OR f.name LIKE '%债券%' OR f.name LIKE '%纯债%' OR f.name LIKE '%短债%' OR f.name LIKE '%中短债%' OR f.name LIKE '%转债%')`;
  }
  if (normalized === "指数型") {
    return Prisma.sql`(f.fundType = '指数型' OR f.name LIKE '%指数%' OR f.name LIKE '%联接%' OR f.name LIKE '%增强%' OR f.name LIKE '%沪深%' OR f.name LIKE '%中证%')`;
  }
  if (normalized === "股票型") {
    return Prisma.sql`(f.fundType = '股票型' OR f.name LIKE '%股票%' OR f.name LIKE '%量化%')`;
  }
  if (normalized === "混合型") {
    return Prisma.sql`(f.fundType = '混合型' OR f.name LIKE '%混合%' OR f.name LIKE '%灵活%' OR f.name LIKE '%优选%' OR f.name LIKE '%精选%' OR f.name LIKE '%成长%' OR f.name LIKE '%价值%')`;
  }
  return Prisma.sql`f.fundType = ${type}`;
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

function normalizeFundBaseName(name: string) {
  return name
    .replace(/\s+/g, "")
    .replace(/(?:人民币)?(?:前端|后端)?(?:A|B|C|D|E|I|Y)(?:类|份额)?$/i, "")
    .replace(/(?:A类|B类|C类|D类|E类|I类|Y类)$/i, "")
    .replace(/(?:联接|链接)?(?:A|C)$/i, "")
    .trim();
}

function inferShareClass(name: string) {
  const normalized = name.replace(/\s+/g, "");
  const match = normalized.match(/(?:人民币)?(?:前端|后端)?([A-Z])(?:类|份额)?$/i);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return "--";
}

function parsePercentRate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeFeeRows(
  fees: Array<{ feeType: string | null; conditionName: string | null; feeValue: string | null }>
) {
  let subscriptionRate: number | null = null;
  let serviceRate: number | null = null;
  let managementRate: number | null = null;
  let custodyRate: number | null = null;
  let redemptionRate: number | null = null;
  let firstFee: string | null = null;

  for (const fee of fees) {
    const feeText = `${fee.feeType ?? ""}${fee.conditionName ?? ""}`;
    const value = parsePercentRate(fee.feeValue);
    if (!firstFee && fee.feeValue) {
      firstFee = `${fee.feeType ?? "费用"} ${fee.conditionName ?? ""} ${fee.feeValue}`.trim();
    }
    if (value === null) {
      continue;
    }
    if (/申购|认购/.test(feeText)) {
      subscriptionRate = subscriptionRate === null ? value : Math.min(subscriptionRate, value);
    } else if (/销售服务/.test(feeText)) {
      serviceRate = serviceRate === null ? value : Math.max(serviceRate, value);
    } else if (/管理/.test(feeText)) {
      managementRate = managementRate === null ? value : Math.max(managementRate, value);
    } else if (/托管/.test(feeText)) {
      custodyRate = custodyRate === null ? value : Math.max(custodyRate, value);
    } else if (/赎回/.test(feeText)) {
      redemptionRate = redemptionRate === null ? value : Math.max(redemptionRate, value);
    }
  }

  return {
    subscriptionRate,
    serviceRate,
    managementRate,
    custodyRate,
    redemptionRate,
    firstFee
  };
}

function estimateClassCost(
  feeSummary: ReturnType<typeof summarizeFeeRows>,
  holdingDays: number,
  amount = 10000
) {
  return estimateKnownFeeCost(feeSummary, holdingDays, amount);
}

function buildShareClassBreakEven(
  items: Array<{
    code: string;
    name: string;
    shareClass: string;
    feeSummary: ReturnType<typeof summarizeFeeRows>;
    cost30d: number | null;
    cost365d: number | null;
  }>
) {
  const aClass = items.find((item) => item.shareClass === "A");
  const cClass = items.find((item) => item.shareClass === "C");
  if (!aClass || !cClass) {
    return null;
  }

  const aSubscription = aClass.feeSummary.subscriptionRate ?? 0;
  const cSubscription = cClass.feeSummary.subscriptionRate ?? 0;
  const aService = aClass.feeSummary.serviceRate ?? 0;
  const cService = cClass.feeSummary.serviceRate ?? 0;
  const serviceDiff = cService - aService;
  const subscriptionDiff = aSubscription - cSubscription;
  const breakEvenDays = serviceDiff > 0 && subscriptionDiff > 0 ? (subscriptionDiff / serviceDiff) * 365 : null;
  const cheapest = (days: number) => {
    const aCost = estimateClassCost(aClass.feeSummary, days);
    const cCost = estimateClassCost(cClass.feeSummary, days);
    if (aCost === null && cCost === null) {
      return { shareClass: "--", code: aClass.code, cost: null };
    }
    if (aCost === null) {
      return { shareClass: "C", code: cClass.code, cost: cCost };
    }
    if (cCost === null) {
      return { shareClass: "A", code: aClass.code, cost: aCost };
    }
    return aCost <= cCost
      ? { shareClass: "A", code: aClass.code, cost: aCost }
      : { shareClass: "C", code: cClass.code, cost: cCost };
  };

  return {
    aCode: aClass.code,
    cCode: cClass.code,
    breakEvenDays,
    better30d: cheapest(30),
    better90d: cheapest(90),
    better365d: cheapest(365)
  };
}

function monthKey(value: Date | string) {
  const date = toDate(value);
  if (!date) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildInvestmentSimulation(
  navs: Array<{ tradeDate: Date | string; unitNav: number | null }>,
  monthlyAmount = 1000
) {
  const points = navs.filter((item) => item.unitNav !== null && item.unitNav !== undefined && item.unitNav > 0);
  if (points.length < 2) {
    return null;
  }

  const buys: typeof points = [];
  const seenMonths = new Set<string>();
  for (const point of points) {
    const key = monthKey(point.tradeDate);
    if (!key || seenMonths.has(key)) {
      continue;
    }
    seenMonths.add(key);
    buys.push(point);
  }

  if (buys.length < 2) {
    return null;
  }

  const latest = points.at(-1);
  if (!latest?.unitNav) {
    return null;
  }

  let shares = 0;
  let invested = 0;
  let buyIndex = 0;
  let maxFloatingLoss = 0;

  for (const point of points) {
    while (buyIndex < buys.length && buys[buyIndex] === point) {
      shares += monthlyAmount / Number(point.unitNav);
      invested += monthlyAmount;
      buyIndex += 1;
    }
    if (invested > 0 && point.unitNav) {
      const value = shares * point.unitNav;
      maxFloatingLoss = Math.min(maxFloatingLoss, (value / invested - 1) * 100);
    }
  }

  const currentValue = shares * latest.unitNav;
  const profit = currentValue - invested;
  const profitRate = invested > 0 ? (profit / invested) * 100 : null;
  const firstBuy = buys[0];
  const lumpShares = firstBuy.unitNav ? invested / firstBuy.unitNav : 0;
  const lumpValue = lumpShares * latest.unitNav;
  const lumpProfitRate = invested > 0 ? (lumpValue / invested - 1) * 100 : null;

  return {
    monthlyAmount,
    months: buys.length,
    startDate: firstBuy.tradeDate,
    endDate: latest.tradeDate,
    invested,
    shares,
    currentValue,
    profit,
    profitRate,
    maxFloatingLoss,
    lumpValue,
    lumpProfitRate
  };
}

async function attachFundListRiskMetrics<T extends FundListItem>(items: T[]) {
  const codes = items.map((item) => item.code);
  if (codes.length === 0) {
    return items;
  }

  const navRows = await prisma.fundNavDaily.findMany({
    where: {
      fundCode: { in: codes },
      unitNav: { not: null }
    },
    orderBy: [{ fundCode: "asc" }, { tradeDate: "desc" }],
    select: {
      fundCode: true,
      tradeDate: true,
      unitNav: true,
      dailyGrowthRate: true
    }
  });

  const navsByCode = new Map<string, typeof navRows>();
  for (const nav of navRows) {
    const bucket = navsByCode.get(nav.fundCode) ?? [];
    if (bucket.length < 380) {
      bucket.push(nav);
      navsByCode.set(nav.fundCode, bucket);
    }
  }

  return items.map((item) => {
    const navs = [...(navsByCode.get(item.code) ?? [])].reverse();
    const riskMetrics = calculateRiskMetrics(navs);
    return {
      ...item,
      maxDrawdown: riskMetrics.maxDrawdown,
      volatility: riskMetrics.volatility
    };
  });
}

function normalizeReturnRange(value: string | null | undefined) {
  return value && FUND_LIST_RETURN_RANGES.includes(value) ? value : "year_1";
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
      await ensureSqlitePragmas();
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
  return rows.map((job) => ({
    ...job,
    syncState: buildSyncJobState({
      status: job.status,
      startedAt: job.startedAt,
      stuckAfterHours: 4
    })
  }));
}

export async function markSyncJobFailed(id: number, reason = "manual mark failed") {
  return prisma.syncJob.update({
    where: { id },
    data: {
      status: "failed",
      finishedAt: new Date(),
      failedSources: "manual",
      message: reason
    }
  });
}

export async function getDataSourceHealth(limit = 80) {
  const jobs = await getRecentSyncJobs(limit);
  return summarizeDataSourceHealth(jobs.map((job) => ({
    jobType: job.jobType,
    status: job.status,
    startedAt: job.startedAt ?? new Date().toISOString(),
    finishedAt: job.finishedAt,
    failedSources: job.failedSources,
    message: job.message
  })));
}

export async function getDashboardSnapshotStatus(snapshotKey = "home-summary") {
  const snapshot = await prisma.dashboardSnapshot.findUnique({ where: { snapshotKey } });
  return {
    snapshot,
    state: buildDashboardSnapshotState(snapshot?.generatedAt ?? null)
  };
}

export async function saveDashboardSnapshot(snapshotKey: string, payload: unknown, ttlMinutes = 30) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60000);
  return prisma.dashboardSnapshot.upsert({
    where: { snapshotKey },
    update: {
      payload: JSON.stringify(payload),
      generatedAt: new Date(),
      expiresAt
    },
    create: {
      snapshotKey,
      payload: JSON.stringify(payload),
      expiresAt
    }
  });
}

export async function getDataCoverage(): Promise<DataCoverageResult> {
  const now = new Date().toISOString();
  if (dataCoverageCache && isSnapshotFresh(dataCoverageCache.generatedAt, now, 10)) {
    return dataCoverageCache.result;
  }
  const [
    fundTotalRows,
    fundTypeRows,
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
    prisma.$queryRaw<Array<{ value: number }>>`
      SELECT COUNT(*) AS value
      FROM Fund
      WHERE fundType IS NOT NULL AND fundType <> '' AND fundType <> '??' AND fundType <> '未知'
    `,
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
      key: "fund_type",
      label: "基金类型",
      value: toCount(fundTypeRows[0]?.value),
      total: fundTotal,
      note: "用于候选池、同类排名、货币/ETF/QDII 专项展示"
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
    "白天边看页面边补数，建议运行 python scripts/collector/run_backfill.py --profile-limit 200 --history-limit 200 --history-days 756。",
    "历史净值补采会优先处理持仓、关注和榜单基金；夜间或不用页面时再运行 python scripts/collector/run_backfill.py --full。",
    "银行理财公开源只能抓到可见样本；若要全市场，需要接入普益标准、Wind、Choice、iFinD 或用 WEALTH_PRODUCTS_JSON 导入授权数据。"
  ];

  const result = {
    fundTotal,
    wealthTotal,
    fundWithAnyNav: toCount(fundNavFundsRows[0]?.value),
    metrics,
    recommendations
  };
  dataCoverageCache = { generatedAt: now, result };
  return result;
}

async function getLatestFundMovers(direction: "asc" | "desc"): Promise<FundListItem[]> {
  const orderSql =
    direction === "asc"
      ? Prisma.sql`latest.dailyGrowthRate ASC NULLS LAST, f.code ASC`
      : Prisma.sql`latest.dailyGrowthRate DESC NULLS LAST, f.code ASC`;
  const rows = await prisma.$queryRaw<FundListItem[]>`
    WITH latest_nav AS (
      SELECT nav.*
      FROM FundNavDaily nav
      JOIN (
        SELECT fundCode, MAX(tradeDate) AS tradeDate
        FROM FundNavDaily
        GROUP BY fundCode
      ) latestDate
        ON latestDate.fundCode = nav.fundCode AND latestDate.tradeDate = nav.tradeDate
    )
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
      NULL AS selectedReturnRange,
      NULL AS selectedReturnDate,
      NULL AS selectedReturn,
      NULL AS maxDrawdown,
      NULL AS volatility,
      NULL AS navSampleCount,
      NULL AS dataCompleteness,
      0 AS hasProfile,
      0 AS hasFee,
      0 AS watched
    FROM Fund f
    JOIN latest_nav latest ON latest.fundCode = f.code
    WHERE latest.dailyGrowthRate IS NOT NULL
    ORDER BY ${orderSql}
    LIMIT 5
  `;

  return rows.map((row) => {
    const classification = classifyFund({
      code: row.code,
      name: row.name,
      fundType: row.fundType
    });
    return {
      ...row,
      fundType: classification.displayType,
      fundTypeSource: classification.source,
      assetMode: classification.assetMode,
      navSampleCount: null,
      dataCompleteness: null,
      hasProfile: false,
      hasFee: false,
      watched: false
    };
  });
}

export async function getSummary(): Promise<SummaryResult> {
  const now = new Date().toISOString();
  if (summaryCache && isSnapshotFresh(summaryCache.generatedAt, now, 5)) {
    return summaryCache.result;
  }
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
      prisma.$queryRaw<Array<{ updated: number; latestDate: string | null }>>`
        SELECT COUNT(*) AS updated, MAX(latest.navDate) AS latestDate
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

  const [topGainers, topLosers, strongCandidateRows, watchedMoveRows, latestFundNavRows] = await Promise.all([
    getLatestFundMovers("desc"),
    getLatestFundMovers("asc"),
    prisma.$queryRaw<Array<{ value: number }>>`
      WITH latest_rank_date AS (
        SELECT rangeKey, MAX(rankDate) AS rankDate
        FROM FundRankDaily
        WHERE rangeKey IN ('month_3', 'month_6', 'year_1')
        GROUP BY rangeKey
      ),
      rank_pivot AS (
        SELECT
          r.fundCode,
          MAX(CASE WHEN r.rangeKey = 'month_3' THEN r.rankValue END) AS month3Return,
          MAX(CASE WHEN r.rangeKey = 'month_6' THEN r.rankValue END) AS month6Return,
          MAX(CASE WHEN r.rangeKey = 'year_1' THEN r.rankValue END) AS year1Return
        FROM FundRankDaily r
        JOIN latest_rank_date latestDate
          ON latestDate.rangeKey = r.rangeKey AND latestDate.rankDate = r.rankDate
        WHERE r.rangeKey IN ('month_3', 'month_6', 'year_1')
        GROUP BY r.fundCode
      ),
      navStat AS (
        SELECT fundCode, COUNT(*) AS navSampleCount
        FROM FundNavDaily
        WHERE unitNav IS NOT NULL
        GROUP BY fundCode
      )
      SELECT COUNT(*) AS value
      FROM (
        SELECT f.code
        FROM Fund f
        JOIN rank_pivot rp ON rp.fundCode = f.code
        JOIN navStat ON navStat.fundCode = f.code
        WHERE navStat.navSampleCount >= 60
          AND (rp.month3Return IS NOT NULL OR rp.month6Return IS NOT NULL OR rp.year1Return IS NOT NULL)
        ORDER BY rp.year1Return DESC NULLS LAST, rp.month6Return DESC NULLS LAST, rp.month3Return DESC NULLS LAST
        LIMIT 60
      ) strongPool
    `,
    prisma.$queryRaw<Array<{ code: string; name: string; dailyGrowthRate: number | null }>>`
      SELECT f.code, f.name, latest.dailyGrowthRate
      FROM Watchlist w
      JOIN Fund f ON f.code = w.fundCode
      LEFT JOIN FundNavDaily latest
        ON latest.id = (
          SELECT id FROM FundNavDaily nav
          WHERE nav.fundCode = f.code
          ORDER BY nav.tradeDate DESC
          LIMIT 1
        )
      WHERE w.targetType = 'fund'
      ORDER BY ABS(COALESCE(latest.dailyGrowthRate, 0)) DESC
      LIMIT 8
    `,
    prisma.$queryRaw<Array<{ latestDate: string | null; rows: number }>>`
      SELECT MAX(tradeDate) AS latestDate, COUNT(*) AS rows
      FROM FundNavDaily
      WHERE tradeDate = (SELECT MAX(tradeDate) FROM FundNavDaily)
    `
  ]);

  const distribution = latestFundRows[0] ?? { positive: 0, negative: 0, flat: 0 };

  const result = {
    fundCount,
    wealthCount,
    wealthUpdatedCount: Number(latestWealthRows[0]?.updated ?? 0),
    fundLatestNavDate: latestFundNavRows[0]?.latestDate ?? null,
    fundLatestNavRows: Number(latestFundNavRows[0]?.rows ?? 0),
    wealthLatestNavDate: latestWealthRows[0]?.latestDate ?? null,
    fundDistribution: {
      positive: Number(distribution.positive ?? 0),
      negative: Number(distribution.negative ?? 0),
      flat: Number(distribution.flat ?? 0)
    },
    latestSync,
    topGainers,
    topLosers,
    dailyHighlights: buildDailyHighlights({
      fundNavDate: latestFundNavRows[0]?.latestDate ?? null,
      asOfDate: new Date().toISOString(),
      newStrongCandidates: Number(strongCandidateRows[0]?.value ?? 0),
      watchedMoves: watchedMoveRows,
      rankingMoves: topGainers.slice(0, 2).map((item) => ({
        code: item.code,
        name: item.name,
        rangeLabel: "最新日",
        rankValue: item.dailyGrowthRate
      })),
      latestSyncStatus: latestSync?.status ?? null
    })
  };
  summaryCache = { generatedAt: now, result };
  try {
    await saveDashboardSnapshot("home-summary", result, 30);
  } catch {
    // Snapshot cache is an optimization; page data should still render if it fails.
  }
  return result;
}

export async function getFundList(params: {
  q?: string | null;
  type?: string | null;
  direction?: string | null;
  purchaseStatus?: string | null;
  view?: string | null;
  returnRange?: string | null;
  minReturn?: string | number | null;
  maxDrawdown?: string | number | null;
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
  const view = params.view ?? "all";
  const returnRange =
    view === "strong_week"
      ? "week_1"
      : view === "strong_quarter"
        ? "month_3"
        : normalizeReturnRange(params.returnRange);

  if (params.q) {
    const pattern = `%${params.q.trim()}%`;
    filters.push(Prisma.sql`(f.code LIKE ${pattern} OR f.name LIKE ${pattern} OR f.pinyin LIKE ${pattern})`);
  }

  if (params.type) {
    filters.push(fundTypeFilter(params.type));
  }

  if (params.purchaseStatus) {
    const pattern = `%${params.purchaseStatus.trim()}%`;
    filters.push(Prisma.sql`f.purchaseStatus LIKE ${pattern}`);
  }

  if (view === "watchlist") {
    filters.push(Prisma.sql`w.id IS NOT NULL`);
  } else if (view === "strong_week" || view === "strong_quarter") {
    filters.push(Prisma.sql`selectedRank.rankValue > 0`);
  } else if (view === "open_purchase") {
    filters.push(Prisma.sql`f.purchaseStatus LIKE '%开放%' AND f.purchaseStatus NOT LIKE '%暂停%'`);
  } else if (view === "data_ready") {
    filters.push(Prisma.sql`
      EXISTS (SELECT 1 FROM FundProfile fpReady WHERE fpReady.fundCode = f.code)
      AND EXISTS (SELECT 1 FROM FundFee feeReady WHERE feeReady.fundCode = f.code)
      AND (
        SELECT COUNT(*)
        FROM FundNavDaily navReady
        WHERE navReady.fundCode = f.code AND navReady.unitNav IS NOT NULL
      ) >= 240
    `);
  }

  if (params.direction === "up") {
    filters.push(Prisma.sql`latest.dailyGrowthRate > 0`);
  } else if (params.direction === "down") {
    filters.push(Prisma.sql`latest.dailyGrowthRate < 0`);
  } else if (params.direction === "flat") {
    filters.push(Prisma.sql`latest.dailyGrowthRate = 0`);
  }

  const minRate = optionalNumber(params.minRate);
  const maxRate = optionalNumber(params.maxRate);
  const minReturn = optionalNumber(params.minReturn);
  const maxDrawdown = optionalNumber(params.maxDrawdown);
  const usesRiskSql = Number.isFinite(maxDrawdown) || params.sort === "drawdown_desc" || view === "low_drawdown";

  if (Number.isFinite(minRate)) {
    filters.push(Prisma.sql`latest.dailyGrowthRate >= ${minRate}`);
  }

  if (Number.isFinite(maxRate)) {
    filters.push(Prisma.sql`latest.dailyGrowthRate <= ${maxRate}`);
  }

  if (Number.isFinite(minReturn)) {
    filters.push(Prisma.sql`selectedRank.rankValue >= ${minReturn}`);
  }

  if (Number.isFinite(maxDrawdown)) {
    filters.push(Prisma.sql`risk.maxDrawdown >= ${maxDrawdown}`);
  }

  if (view === "low_drawdown") {
    filters.push(Prisma.sql`risk.maxDrawdown >= -10 AND selectedRank.rankValue > 0`);
  }

  const whereSql = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const riskWithSql = usesRiskSql
    ? Prisma.sql`
      WITH recent_nav AS (
        SELECT
          fundCode,
          tradeDate,
          unitNav,
          dailyGrowthRate,
          ROW_NUMBER() OVER (PARTITION BY fundCode ORDER BY tradeDate DESC) AS recency
        FROM FundNavDaily
        WHERE unitNav IS NOT NULL AND unitNav > 0
      ),
      ordered_nav AS (
        SELECT fundCode, tradeDate, unitNav, dailyGrowthRate
        FROM recent_nav
        WHERE recency <= 380
      ),
      nav_window AS (
        SELECT
          fundCode,
          tradeDate,
          unitNav,
          MAX(unitNav) OVER (
            PARTITION BY fundCode
            ORDER BY tradeDate ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS runningPeak
        FROM ordered_nav
      ),
      risk AS (
        SELECT
          fundCode,
          MIN((unitNav / NULLIF(runningPeak, 0) - 1) * 100) AS maxDrawdown
        FROM nav_window
        GROUP BY fundCode
      )
    `
    : Prisma.empty;
  const riskJoinSql = usesRiskSql ? Prisma.sql`LEFT JOIN risk ON risk.fundCode = f.code` : Prisma.empty;
  const riskSelectSql = usesRiskSql ? Prisma.sql`risk.maxDrawdown` : Prisma.sql`NULL`;

  const orderSql =
    params.sort === "growth_asc"
      ? Prisma.sql`latest.dailyGrowthRate ASC NULLS LAST, f.code ASC`
      : params.sort === "name"
        ? Prisma.sql`f.name ASC, f.code ASC`
        : params.sort === "return_desc"
          ? Prisma.sql`selectedRank.rankValue DESC NULLS LAST, f.code ASC`
          : params.sort === "return_asc"
            ? Prisma.sql`selectedRank.rankValue ASC NULLS LAST, f.code ASC`
            : params.sort === "drawdown_desc"
              ? Prisma.sql`risk.maxDrawdown DESC NULLS LAST, f.code ASC`
              : Prisma.sql`latest.dailyGrowthRate DESC NULLS LAST, f.code ASC`;

  const rows = await prisma.$queryRaw<FundListItem[]>`
    ${riskWithSql}
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
      ${returnRange} AS selectedReturnRange,
      selectedRank.rankDate AS selectedReturnDate,
      selectedRank.rankValue AS selectedReturn,
      ${riskSelectSql} AS maxDrawdown,
      NULL AS volatility,
      navStat.navSampleCount,
      CASE
        WHEN navStat.navSampleCount >= 720 AND fp.fundCode IS NOT NULL AND fee.fundCode IS NOT NULL THEN 100
        WHEN navStat.navSampleCount >= 240 AND fp.fundCode IS NOT NULL AND fee.fundCode IS NOT NULL THEN 80
        WHEN navStat.navSampleCount >= 60 THEN 55
        WHEN navStat.navSampleCount >= 14 THEN 35
        ELSE 15
      END AS dataCompleteness,
      CASE WHEN fp.fundCode IS NULL THEN 0 ELSE 1 END AS hasProfile,
      CASE WHEN fee.fundCode IS NULL THEN 0 ELSE 1 END AS hasFee,
      CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS watched
    FROM Fund f
    LEFT JOIN FundNavDaily latest
      ON latest.id = (
        SELECT id FROM FundNavDaily nav
        WHERE nav.fundCode = f.code
        ORDER BY nav.tradeDate DESC
        LIMIT 1
      )
    LEFT JOIN FundRankDaily selectedRank
      ON selectedRank.id = (
        SELECT id FROM FundRankDaily rankRow
        WHERE rankRow.fundCode = f.code AND rankRow.rangeKey = ${returnRange}
        ORDER BY rankRow.rankDate DESC, rankRow.createdAt DESC
        LIMIT 1
      )
    ${riskJoinSql}
    LEFT JOIN FundProfile fp ON fp.fundCode = f.code
    LEFT JOIN (
      SELECT fundCode, COUNT(*) AS navSampleCount
      FROM FundNavDaily
      WHERE unitNav IS NOT NULL
      GROUP BY fundCode
    ) navStat ON navStat.fundCode = f.code
    LEFT JOIN (
      SELECT DISTINCT fundCode
      FROM FundFee
    ) fee ON fee.fundCode = f.code
    LEFT JOIN Watchlist w
      ON w.targetType = 'fund' AND w.fundCode = f.code
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;

  const items = rows.map((row) => {
    const classification = classifyFund({
      code: row.code,
      name: row.name,
      fundType: row.fundType
    });
    const navSampleCount = Number(row.navSampleCount ?? 0);
    const hasProfile = Boolean(Number(row.hasProfile ?? 0));
    const hasFee = Boolean(Number(row.hasFee ?? 0));
    const coverage = buildFundDataCoverage({
      navSampleCount,
      latestNavDate: row.tradeDate,
      periodReturnCount: row.selectedReturn === null || row.selectedReturn === undefined ? 0 : 1,
      hasProfile,
      hasFee,
      hasRating: false,
      stockHoldingCount: 0,
      bondHoldingCount: 0,
      industryCount: 0,
      announcementCount: 0,
      assetMode: classification.assetMode
    });
    return {
      ...row,
      fundType: classification.displayType,
      fundTypeSource: classification.source,
      assetMode: classification.assetMode,
      navSampleCount,
      dataCompleteness: coverage.score,
      dataQualityLabel: coverage.label,
      missingActions: coverage.missingActions,
      hasProfile,
      hasFee,
      watched: Boolean(Number(row.watched))
    };
  });

  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>`
    ${riskWithSql}
    SELECT COUNT(*) AS total
    FROM Fund f
    LEFT JOIN FundNavDaily latest
      ON latest.id = (
        SELECT id FROM FundNavDaily nav
        WHERE nav.fundCode = f.code
        ORDER BY nav.tradeDate DESC
        LIMIT 1
      )
    LEFT JOIN FundRankDaily selectedRank
      ON selectedRank.id = (
        SELECT id FROM FundRankDaily rankRow
        WHERE rankRow.fundCode = f.code AND rankRow.rangeKey = ${returnRange}
        ORDER BY rankRow.rankDate DESC, rankRow.createdAt DESC
        LIMIT 1
      )
    ${riskJoinSql}
    LEFT JOIN Watchlist w
      ON w.targetType = 'fund' AND w.fundCode = f.code
    ${whereSql}
  `;

  const total = Number(totalRows[0]?.total ?? 0);

  return {
    items: await attachFundListRiskMetrics(items),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

function isOpenPurchaseStatus(status: string | null | undefined) {
  if (!status) {
    return false;
  }
  const text = status.replace(/\s/g, "");
  return /(开放|申购|寮€鏀?|鐢宠喘)/.test(text) && !/(暂停|封闭|停止|不可|限制|鏆傚仠|灏侀棴|鍋滄|涓嶅彲|闄愬埗)/.test(text);
}

function positiveScore(value: number | null | undefined, weight: number) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.min(weight, value * 1.2);
}

function buildCandidateReasons(input: {
  dataScore: number;
  openPurchase: boolean;
  month3Return: number | null;
  month6Return: number | null;
  year1Return: number | null;
  peerPercentile: number | null;
  maxDrawdown: number | null;
}) {
  const reasons: string[] = [];
  if (input.dataScore >= 70) reasons.push("数据较完整");
  if (input.openPurchase) reasons.push("当前可申购");
  if ((input.month3Return ?? 0) > 0 && (input.month6Return ?? 0) > 0) reasons.push("近 3 月和近 6 月收益为正");
  if ((input.year1Return ?? 0) > 0) reasons.push("近 1 年收益为正");
  if ((input.peerPercentile ?? 0) >= 70) reasons.push("近 1 年同类百分位靠前");
  if (input.maxDrawdown !== null && input.maxDrawdown >= -10) reasons.push("样本回撤相对可控");
  return reasons;
}

function buildCandidateRisks(input: {
  dataScore: number;
  openPurchase: boolean;
  maxDrawdown: number | null;
  volatility: number | null;
  hasProfile: boolean;
  hasFee: boolean;
  highImpactAnnouncementCount: number;
  assetMode: string | null;
}) {
  const risks: string[] = [];
  if (!input.openPurchase) risks.push("申购状态需确认");
  if (input.dataScore < 55) risks.push("数据可信度偏低");
  if (!input.hasProfile) risks.push("缺少基金画像");
  if (!input.hasFee) risks.push("缺少费率信息");
  if (input.maxDrawdown !== null && input.maxDrawdown <= -20) risks.push("样本最大回撤较深");
  if (input.volatility !== null && input.volatility >= 35) risks.push("波动率较高");
  if (input.highImpactAnnouncementCount > 0) risks.push("近期存在高影响公告");
  if (input.assetMode === "qdii") risks.push("QDII 净值可能滞后");
  if (input.assetMode === "unknown") risks.push("基金类型仍需确认");
  return risks;
}

async function attachCandidateRiskMetrics<T extends FundCandidateItem>(items: T[]) {
  const codes = items.map((item) => item.code);
  if (!codes.length) {
    return items;
  }

  const navRows = await prisma.$queryRaw<
    Array<{
      fundCode: string;
      tradeDate: Date | string;
      unitNav: number | null;
      dailyGrowthRate: number | null;
    }>
  >`
    SELECT fundCode, tradeDate, unitNav, dailyGrowthRate
    FROM (
      SELECT
        fundCode,
        tradeDate,
        unitNav,
        dailyGrowthRate,
        ROW_NUMBER() OVER (PARTITION BY fundCode ORDER BY tradeDate DESC) AS rn
      FROM FundNavDaily
      WHERE fundCode IN (${Prisma.join(codes)})
        AND unitNav IS NOT NULL
    )
    WHERE rn <= 380
    ORDER BY fundCode ASC, tradeDate DESC
  `;

  const navsByCode = new Map<string, typeof navRows>();
  for (const nav of navRows) {
    const bucket = navsByCode.get(nav.fundCode) ?? [];
    if (bucket.length < 380) {
      bucket.push(nav);
      navsByCode.set(nav.fundCode, bucket);
    }
  }

  return items.map((item) => {
    const navs = [...(navsByCode.get(item.code) ?? [])].reverse();
    const riskMetrics = calculateRiskMetrics(navs);
    const openPurchase = isOpenPurchaseStatus(item.purchaseStatus);
    const drawdownScore =
      riskMetrics.maxDrawdown === null
        ? 0
        : riskMetrics.maxDrawdown >= -8
          ? 15
          : riskMetrics.maxDrawdown >= -15
            ? 10
            : riskMetrics.maxDrawdown >= -25
              ? 4
              : 0;
    const returnScore =
      positiveScore(item.weekReturn, 5) +
      positiveScore(item.month3Return, 12) +
      positiveScore(item.month6Return, 12) +
      positiveScore(item.year1Return, 12);
    const peerScore = item.peerPercentile === null ? 0 : Math.max(0, Math.min(15, (item.peerPercentile - 50) * 0.6));
    const penalty =
      (openPurchase ? 0 : 14) +
      (item.highImpactAnnouncementCount > 0 ? 16 : 0) +
      (item.assetMode === "money" ? 20 : 0) +
      (item.assetMode === "unknown" ? 6 : 0);
    const observationScore = Math.max(
      0,
      Math.min(100, Math.round(item.dataScore * 0.35 + returnScore + peerScore + drawdownScore + (openPurchase ? 10 : 0) - penalty))
    );
    const reasons = buildCandidateReasons({
      dataScore: item.dataScore,
      openPurchase,
      month3Return: item.month3Return,
      month6Return: item.month6Return,
      year1Return: item.year1Return,
      peerPercentile: item.peerPercentile,
      maxDrawdown: riskMetrics.maxDrawdown
    });
    const risks = buildCandidateRisks({
      dataScore: item.dataScore,
      openPurchase,
      maxDrawdown: riskMetrics.maxDrawdown,
      volatility: riskMetrics.volatility,
      hasProfile: item.hasProfile,
      hasFee: item.hasFee,
      highImpactAnnouncementCount: item.highImpactAnnouncementCount,
      assetMode: item.assetMode
    });

    return {
      ...item,
      maxDrawdown: riskMetrics.maxDrawdown,
      volatility: riskMetrics.volatility,
      observationScore,
      reasons: reasons.length ? reasons : ["进入基础观察池"],
      risks
    };
  });
}

type FundCandidatePoolResult = PagedResult<FundCandidateItem> & { summary: FundCandidateSummary };

const fundCandidatePoolCache = new Map<string, { generatedAt: string; result: FundCandidatePoolResult }>();

export async function getFundCandidatePool(params: {
  type?: string | null;
  grade?: string | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}): Promise<FundCandidatePoolResult> {
  const page = toPositiveInt(params.page, 1);
  const pageSize = clampPageSize(params.pageSize);
  const cacheKey = JSON.stringify({
    type: params.type ?? "",
    grade: params.grade ?? "all",
    sort: params.sort ?? "score",
    page,
    pageSize
  });
  const cached = fundCandidatePoolCache.get(cacheKey);
  const now = new Date().toISOString();
  if (cached && isSnapshotFresh(cached.generatedAt, now, 20)) {
    return cached.result;
  }
  const filters: Prisma.Sql[] = [
    Prisma.sql`navStat.navSampleCount >= 60`,
    Prisma.sql`(rp.month3Return IS NOT NULL OR rp.month6Return IS NOT NULL OR rp.year1Return IS NOT NULL)`
  ];
  if (params.type) {
    filters.push(fundTypeFilter(params.type));
  }
  const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

  const rows = await withDatabaseRetry(() => prisma.$queryRaw<
    Array<{
      code: string;
      name: string;
      fundType: string | null;
      purchaseStatus: string | null;
      tradeDate: Date | string | null;
      unitNav: number | null;
      dailyGrowthRate: number | null;
      weekReturn: number | null;
      month3Return: number | null;
      month6Return: number | null;
      year1Return: number | null;
      peerTotal: number | null;
      peerRank: number | null;
      navSampleCount: number | null;
      hasProfile: number | null;
      hasFee: number | null;
      highImpactAnnouncementCount: number | null;
      watched: number | null;
    }>
  >`
    WITH latest_rank_date AS (
      SELECT rangeKey, MAX(rankDate) AS rankDate
      FROM FundRankDaily
      WHERE rangeKey IN ('week_1', 'month_3', 'month_6', 'year_1')
      GROUP BY rangeKey
    ),
    rank_pivot AS (
      SELECT
        r.fundCode,
        MAX(CASE WHEN r.rangeKey = 'week_1' THEN r.rankValue END) AS weekReturn,
        MAX(CASE WHEN r.rangeKey = 'month_3' THEN r.rankValue END) AS month3Return,
        MAX(CASE WHEN r.rangeKey = 'month_6' THEN r.rankValue END) AS month6Return,
        MAX(CASE WHEN r.rangeKey = 'year_1' THEN r.rankValue END) AS year1Return
      FROM FundRankDaily r
      JOIN latest_rank_date latestDate
        ON latestDate.rangeKey = r.rangeKey AND latestDate.rankDate = r.rankDate
      WHERE r.rangeKey IN ('week_1', 'month_3', 'month_6', 'year_1')
      GROUP BY r.fundCode
    ),
    navStat AS (
      SELECT fundCode, COUNT(*) AS navSampleCount, MAX(tradeDate) AS latestTradeDate
      FROM FundNavDaily
      WHERE unitNav IS NOT NULL
      GROUP BY fundCode
    ),
    year_peer AS (
      SELECT
        rp.fundCode,
        COUNT(*) OVER (PARTITION BY f.fundType) AS peerTotal,
        RANK() OVER (PARTITION BY f.fundType ORDER BY rp.year1Return DESC) AS peerRank
      FROM rank_pivot rp
      JOIN Fund f ON f.code = rp.fundCode
      WHERE rp.year1Return IS NOT NULL
    )
    SELECT
      f.code,
      f.name,
      f.fundType,
      f.purchaseStatus,
      latest.tradeDate,
      latest.unitNav,
      latest.dailyGrowthRate,
      rp.weekReturn,
      rp.month3Return,
      rp.month6Return,
      rp.year1Return,
      peer.peerTotal,
      peer.peerRank,
      navStat.navSampleCount,
      CASE WHEN fp.fundCode IS NULL THEN 0 ELSE 1 END AS hasProfile,
      CASE WHEN fee.fundCode IS NULL THEN 0 ELSE 1 END AS hasFee,
      COALESCE(ann.highImpactAnnouncementCount, 0) AS highImpactAnnouncementCount,
      CASE WHEN w.id IS NULL THEN 0 ELSE 1 END AS watched
    FROM Fund f
    JOIN rank_pivot rp ON rp.fundCode = f.code
    JOIN navStat ON navStat.fundCode = f.code
    LEFT JOIN FundNavDaily latest
      ON latest.fundCode = f.code AND latest.tradeDate = navStat.latestTradeDate
    LEFT JOIN year_peer peer ON peer.fundCode = f.code
    LEFT JOIN FundProfile fp ON fp.fundCode = f.code
    LEFT JOIN (SELECT DISTINCT fundCode FROM FundFee) fee ON fee.fundCode = f.code
    LEFT JOIN (
      SELECT fundCode, COUNT(*) AS highImpactAnnouncementCount
      FROM Announcement
      WHERE targetType = 'fund'
        AND (source LIKE '%personnel%' OR title LIKE '%经理%' OR title LIKE '%暂停%' OR title LIKE '%清盘%' OR title LIKE '%终止%' OR title LIKE '%费率%')
      GROUP BY fundCode
    ) ann ON ann.fundCode = f.code
    LEFT JOIN Watchlist w ON w.targetType = 'fund' AND w.fundCode = f.code
    ${whereSql}
    ORDER BY
      rp.year1Return DESC NULLS LAST,
      rp.month6Return DESC NULLS LAST,
      rp.month3Return DESC NULLS LAST,
      f.code ASC
    LIMIT 800
  `);

  const baseItems: FundCandidateItem[] = rows.map((row) => {
    const classification = classifyFund({
      code: row.code,
      name: row.name,
      fundType: row.fundType
    });
    const navSampleCount = Number(row.navSampleCount ?? 0);
    const hasProfile = Boolean(Number(row.hasProfile ?? 0));
    const hasFee = Boolean(Number(row.hasFee ?? 0));
    const periodReturnCount = [row.weekReturn, row.month3Return, row.month6Return, row.year1Return].filter(
      (value) => value !== null && value !== undefined
    ).length;
    const coverage = buildFundDataCoverage({
      navSampleCount,
      latestNavDate: row.tradeDate,
      periodReturnCount,
      hasProfile,
      hasFee,
      hasRating: false,
      stockHoldingCount: 0,
      bondHoldingCount: 0,
      industryCount: 0,
      announcementCount: Number(row.highImpactAnnouncementCount ?? 0),
      assetMode: classification.assetMode
    });
    const peerTotal = Number(row.peerTotal ?? 0);
    const peerRank = Number(row.peerRank ?? 0);
    const peerPercentile = peerTotal > 0 && peerRank > 0 ? ((peerTotal - peerRank + 1) / peerTotal) * 100 : null;
    return {
      code: row.code,
      name: row.name,
      fundType: classification.displayType,
      assetMode: classification.assetMode,
      tradeDate: row.tradeDate,
      unitNav: row.unitNav,
      dailyGrowthRate: row.dailyGrowthRate,
      weekReturn: row.weekReturn,
      month3Return: row.month3Return,
      month6Return: row.month6Return,
      year1Return: row.year1Return,
      peerPercentile,
      maxDrawdown: null,
      volatility: null,
      dataScore: coverage.score,
      observationScore: 0,
      navSampleCount,
      hasProfile,
      hasFee,
      highImpactAnnouncementCount: Number(row.highImpactAnnouncementCount ?? 0),
      purchaseStatus: row.purchaseStatus,
      watched: Boolean(Number(row.watched ?? 0)),
      reasons: [],
      risks: []
    };
  });

  const withRisk = await attachCandidateRiskMetrics(baseItems);
  const ranked = assignCandidateTiers(
    [...withRisk].sort((a, b) => b.observationScore - a.observationScore || (b.year1Return ?? -999) - (a.year1Return ?? -999))
  );
  const grade = params.grade ?? "all";
  const filtered = ranked.filter((item) => {
    if (grade === "strong") return item.observationTier === "strong";
    if (grade === "watchable") return item.observationTier === "watchable";
    if (grade === "cautious") return item.observationTier === "cautious";
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (params.sort === "drawdown") {
      return (b.maxDrawdown ?? -999) - (a.maxDrawdown ?? -999) || b.observationScore - a.observationScore;
    }
    if (params.sort === "year") {
      return (b.year1Return ?? -999) - (a.year1Return ?? -999) || b.observationScore - a.observationScore;
    }
    if (params.sort === "data") {
      return b.dataScore - a.dataScore || b.observationScore - a.observationScore;
    }
    return b.observationScore - a.observationScore || (b.year1Return ?? -999) - (a.year1Return ?? -999);
  });

  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);
  const summary: FundCandidateSummary = {
    totalScanned: ranked.length,
    strongCount: ranked.filter((item) => item.observationTier === "strong").length,
    watchableCount: ranked.filter((item) => item.observationTier === "watchable").length,
    cautiousCount: ranked.filter((item) => item.observationTier === "cautious").length,
    generatedAt: new Date().toISOString()
  };

  const result = {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary
  };
  fundCandidatePoolCache.set(cacheKey, { generatedAt: summary.generatedAt, result });
  return result;
}

async function getPeerPercentiles(input: {
  fundCode: string;
  fundType: string | null;
  periodReturns: Array<{ rangeKey: string; rankValue: number | null; rankDate: Date | string | null }>;
}) {
  const result = new Map<string, { peerRank: number | null; peerTotal: number; peerPercentile: number | null }>();
  await Promise.all(
    input.periodReturns.map(async (period) => {
      if (period.rankValue === null || period.rankValue === undefined || !period.rankDate) {
        result.set(period.rangeKey, { peerRank: null, peerTotal: 0, peerPercentile: null });
        return;
      }
      const typeFilter = input.fundType
        ? Prisma.sql`AND ${fundTypeFilter(input.fundType)}`
        : Prisma.empty;
      const rows = await prisma.$queryRaw<Array<{ total: number; better: number }>>`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN r.rankValue > ${period.rankValue} THEN 1 ELSE 0 END) AS better
        FROM FundRankDaily r
        JOIN Fund f ON f.code = r.fundCode
        WHERE r.rangeKey = ${period.rangeKey}
          AND r.rankDate = ${period.rankDate}
          AND r.rankValue IS NOT NULL
          ${typeFilter}
      `;
      const total = Number(rows[0]?.total ?? 0);
      const better = Number(rows[0]?.better ?? 0);
      const peerRank = total > 0 ? better + 1 : null;
      const peerPercentile = total > 0 ? ((total - better) / total) * 100 : null;
      result.set(period.rangeKey, { peerRank, peerTotal: total, peerPercentile });
    })
  );
  return result;
}

async function getShareClassComparison(fundCode: string, fundName: string) {
  const baseName = normalizeFundBaseName(fundName);
  if (!baseName || baseName.length < 3) {
    return { baseName: fundName, items: [], breakEven: null };
  }

  const candidates = await prisma.fund.findMany({
    where: {
      OR: [{ code: fundCode }, { name: { startsWith: baseName } }]
    },
    include: {
      fees: {
        orderBy: [{ feeType: "asc" }, { id: "asc" }],
        take: 30
      },
      navs: {
        orderBy: { tradeDate: "desc" },
        take: 1
      },
      ranks: {
        where: { rangeKey: "year_1" },
        orderBy: [{ rankDate: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    },
    take: 20
  });

  const items = candidates
    .filter((item) => normalizeFundBaseName(item.name) === baseName)
    .map((item) => {
      const feeSummary = summarizeFeeRows(item.fees);
      return {
        code: item.code,
        name: item.name,
        shareClass: inferShareClass(item.name),
        isCurrent: item.code === fundCode,
        purchaseStatus: item.purchaseStatus,
        redeemStatus: item.redeemStatus,
        latestNav: item.navs[0]?.unitNav ?? null,
        latestNavDate: item.navs[0]?.tradeDate ?? null,
        yearReturn: item.ranks[0]?.rankValue ?? null,
        feeSummary,
        cost30d: estimateClassCost(feeSummary, 30),
        cost365d: estimateClassCost(feeSummary, 365)
      };
    })
    .sort((a, b) => {
      if (a.shareClass === b.shareClass) {
        return a.code.localeCompare(b.code);
      }
      return a.shareClass.localeCompare(b.shareClass);
    });

  return { baseName, items, breakEven: buildShareClassBreakEven(items) };
}

export async function getFundDetail(code: string) {
  await ensureSqlitePragmas();
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
      holdings: {
        where: { ratio: { not: null } },
        orderBy: [{ reportPeriod: "desc" }, { ratio: "desc" }],
        take: 30
      },
      industries: {
        where: { ratio: { not: null } },
        orderBy: [{ reportDate: "desc" }, { ratio: "desc" }],
        take: 30
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
  const basePeriodReturns = FUND_DETAIL_RETURN_RANGES.map((range) => {
    const row = latestReturnByRange.get(range.key);
    return {
      rangeKey: range.key,
      label: range.label,
      rankValue: row?.rankValue ?? null,
      rankDate: row?.rankDate ?? null
    };
  });
  const orderedNavs = [...fund.navs].reverse();
  const classification = classifyFund({
    code: fund.code,
    name: fund.name,
    fundType: fund.fundType,
    fundTypeDetail: fund.profile?.fundTypeDetail,
    benchmark: fund.profile?.benchmark
  });
  const [peerPercentiles, shareClassComparison, holdingCounts, latestMoneyData, latestExchangeQuote, navSampleTotal] = await Promise.all([
    getPeerPercentiles({ fundCode: fund.code, fundType: classification.normalizedType, periodReturns: basePeriodReturns }),
    getShareClassComparison(fund.code, fund.name),
    Promise.all([
      prisma.fundHolding.count({ where: { fundCode: code } }),
      prisma.fundBondHolding.count({ where: { fundCode: code } }),
      prisma.fundIndustryAllocation.count({ where: { fundCode: code } })
    ]).then(([stockHoldings, bondHoldings, industries]) => ({ stockHoldings, bondHoldings, industries })),
    prisma.fundMoneyDaily.findFirst({
      where: { fundCode: code },
      orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }]
    }),
    prisma.fundExchangeQuote.findFirst({
      where: { fundCode: code },
      orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }]
    }),
    prisma.fundNavDaily.count({
      where: { fundCode: code, unitNav: { not: null } }
    })
  ]);
  const periodReturns = basePeriodReturns.map((period) => ({
    ...period,
    ...(peerPercentiles.get(period.rangeKey) ?? { peerRank: null, peerTotal: 0, peerPercentile: null })
  }));
  const riskMetrics = calculateRiskMetrics(orderedNavs);
  const investmentSimulation = buildInvestmentSimulation(orderedNavs);
  const latestNav = orderedNavs.at(-1);
  const classifiedAnnouncements = fund.announcements.map((item) => ({
    ...item,
    impact: classifyAnnouncementImpact(item.title, item.source)
  }));
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
  const highImpactAnnouncement = classifiedAnnouncements.find((item) => item.impact.level === "high");
  if (highImpactAnnouncement) {
    warnings.push({
      level: "high",
      targetType: "fund",
      targetKey: fund.code,
      title: "近期有高影响公告",
      message: `${highImpactAnnouncement.title}。`,
      metric: "high_impact_announcement"
    });
  } else if (classifiedAnnouncements.some((item) => item.source.includes("personnel"))) {
    warnings.push({
      level: "low",
      targetType: "fund",
      targetKey: fund.code,
      title: "近期有人事公告",
      message: "详情页公告中包含基金经理或人员变动相关披露。",
      metric: "personnel_announcement"
    });
  }
  const dataCoverage = buildFundDataCoverage({
    navSampleCount: orderedNavs.length,
    latestNavDate: latestNav?.tradeDate ?? null,
    periodReturnCount: periodReturns.filter((item) => item.rankValue !== null && item.rankValue !== undefined).length,
    hasProfile: Boolean(fund.profile),
    hasFee: fund.fees.length > 0,
    hasRating: fund.ratings.length > 0,
    stockHoldingCount: holdingCounts.stockHoldings,
    bondHoldingCount: holdingCounts.bondHoldings,
    industryCount: holdingCounts.industries,
    announcementCount: classifiedAnnouncements.length,
    hasMoneyData: Boolean(latestMoneyData),
    hasExchangeQuote: Boolean(latestExchangeQuote),
    assetMode: classification.assetMode
  });

  return {
    ...fund,
    fundType: classification.displayType,
    fundTypeSource: classification.source,
    fundClassification: classification,
    dataCoverage,
    holdingCounts,
    latestMoneyData,
    latestExchangeQuote,
    navSampleTotal,
    navs: orderedNavs,
    announcements: classifiedAnnouncements,
    periodReturns,
    riskMetrics,
    investmentSimulation,
    shareClassComparison,
    latestRating: fund.ratings[0] ?? null,
    warnings,
    watched: fund.watchlistEntries.length > 0
  };
}

export async function getFundAlternatives(currentCode: string, fundType: string | null | undefined, maxAlternatives = 5) {
  const pool = await getFundCandidatePool({
    type: fundType ?? null,
    page: 1,
    pageSize: 100,
    sort: "score"
  });
  return chooseAlternativeFunds({
    currentCode,
    fundType: fundType ?? null,
    candidates: pool.items,
    maxAlternatives
  }).map((item) => ({
    code: item.code,
    name: item.name,
    fundType: item.fundType,
    observationScore: item.observationScore,
    observationTier: item.observationTier ?? null,
    maxDrawdown: item.maxDrawdown,
    volatility: item.volatility,
    year1Return: item.year1Return,
    month6Return: item.month6Return,
    peerPercentile: item.peerPercentile,
    dataScore: item.dataScore,
    purchaseStatus: item.purchaseStatus,
    risks: item.risks
  }));
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
  dataStatus?: string | null;
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

  if (params.dataStatus === "with_change") {
    filters.push(Prisma.sql`latest.netValue IS NOT NULL AND latest.dailyChangeRate IS NOT NULL`);
  } else if (params.dataStatus === "net_value_only") {
    filters.push(Prisma.sql`latest.netValue IS NOT NULL AND latest.dailyChangeRate IS NULL`);
  } else if (params.dataStatus === "disclosure_only") {
    filters.push(Prisma.sql`latest.netValue IS NULL`);
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
      CASE
        WHEN latest.netValue IS NOT NULL AND latest.dailyChangeRate IS NOT NULL THEN 'with_change'
        WHEN latest.netValue IS NOT NULL THEN 'net_value_only'
        ELSE 'disclosure_only'
      END AS navStatus,
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

function parseWatchlistNote(note: string | null) {
  let payload: Record<string, unknown> = {};
  if (note) {
    try {
      const parsed = JSON.parse(note);
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = { reviewNote: note };
    }
  }
  const preferences = normalizeInvestmentPreferences(payload);
  return {
    ...preferences,
    observationStatus: normalizeWatchlistStatus(payload.observationStatus),
    buyCondition: typeof payload.buyCondition === "string" ? payload.buyCondition : "",
    rejectCondition: typeof payload.rejectCondition === "string" ? payload.rejectCondition : "",
    reviewDate: typeof payload.reviewDate === "string" ? payload.reviewDate : "",
    reviewNote: typeof payload.reviewNote === "string" ? payload.reviewNote : ""
  };
}

async function getPortfolioQuickSnapshot() {
  const holdings = await prisma.portfolioHolding.findMany({
    include: {
      fund: {
        include: {
          navs: { orderBy: { tradeDate: "desc" }, take: 1 },
          fees: { orderBy: [{ feeType: "asc" }, { id: "asc" }], take: 20 }
        }
      },
      product: {
        include: {
          navs: { orderBy: { navDate: "desc" }, take: 1 }
        }
      }
    },
    take: 300
  });
  const baseItems = holdings.map((holding) => {
    const latestFundNav = holding.fund?.navs[0];
    const latestWealthNav = holding.product?.navs[0];
    const latestPrice = latestFundNav?.unitNav ?? latestWealthNav?.netValue ?? null;
    const shares =
      holding.shares ??
      (holding.costAmount && holding.costPrice && holding.costPrice > 0 ? holding.costAmount / holding.costPrice : null);
    const currentValue = shares && latestPrice ? shares * latestPrice : holding.costAmount;
    const profit = currentValue !== null && holding.costAmount !== null ? currentValue - holding.costAmount : null;
    const profitRate = profit !== null && holding.costAmount && holding.costAmount > 0 ? (profit / holding.costAmount) * 100 : null;
    const feeSummary = holding.fund ? summarizeFeeRows(holding.fund.fees) : null;
    return {
      targetType: holding.targetType,
      targetKey: holding.targetKey,
      currentValue,
      profitRate,
      holdingDays: daysBetween(holding.purchaseDate, latestFundNav?.tradeDate ?? latestWealthNav?.navDate ?? new Date()),
      redemptionRate: feeSummary?.redemptionRate ?? null
    };
  });
  const totalValue = baseItems.reduce((sum, item) => sum + (item.currentValue ?? 0), 0);
  return baseItems.map((item) => ({
    ...item,
    positionWeight: totalValue > 0 && item.currentValue ? (item.currentValue / totalValue) * 100 : null
  }));
}

export async function getFundWatchlistWorkbench() {
  const [rows, portfolio] = await Promise.all([
    prisma.watchlist.findMany({
    where: { targetType: { in: ["fund", "wealth"] } },
    include: {
      fund: {
        include: {
          navs: { orderBy: { tradeDate: "desc" }, take: 1 },
          ranks: { where: { rangeKey: "year_1" }, orderBy: [{ rankDate: "desc" }, { createdAt: "desc" }], take: 1 },
          profile: true
        }
      },
      product: {
        include: {
          navs: { orderBy: { navDate: "desc" }, take: 1 }
        }
      }
    },
    orderBy: [{ createdAt: "desc" }],
    take: 300
    }),
    getPortfolioQuickSnapshot()
  ]);
  const portfolioByTarget = new Map(portfolio.map((item) => [`${item.targetType}:${item.targetKey}`, item]));

  const items = rows.map((row) => {
    const decision = parseWatchlistNote(row.note);
    const fund = row.fund;
    const product = row.product;
    const portfolioItem = portfolioByTarget.get(`${row.targetType}:${row.targetKey}`);
    const fundNav = fund?.navs[0];
    const productNav = product?.navs[0];
    const targetType = row.targetType === "wealth" ? "wealth" : "fund";
    const targetKey = row.targetKey;
    return {
      id: row.id,
      targetType,
      targetKey,
      name: fund?.name ?? product?.name ?? targetKey,
      href: targetType === "fund" ? `/funds/${encodeURIComponent(targetKey)}` : `/wealth/${encodeURIComponent(targetKey)}`,
      latestDate: fundNav?.tradeDate ?? productNav?.navDate ?? null,
      latestValue: fundNav?.unitNav ?? productNav?.netValue ?? null,
      dailyRate: fundNav?.dailyGrowthRate ?? productNav?.dailyChangeRate ?? null,
      yearReturn: fund?.ranks[0]?.rankValue ?? null,
      purchaseStatus: fund?.purchaseStatus ?? product?.saleStatus ?? null,
      manager: fund?.profile?.managerNames ?? product?.managerName ?? product?.issuer ?? null,
      createdAt: row.createdAt,
      held: Boolean(portfolioItem),
      profitRate: portfolioItem?.profitRate ?? null,
      positionWeight: portfolioItem?.positionWeight ?? null,
      holdingDays: portfolioItem?.holdingDays ?? null,
      redemptionRate: portfolioItem?.redemptionRate ?? null,
      ...decision
    };
  });

  return { items };
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

export async function saveWatchlistDecision(input: {
  targetType: "fund" | "wealth";
  code: string;
  settings: Record<string, unknown>;
}) {
  const code = input.code.trim();
  if (!code) {
    throw new Error("code is required");
  }
  const note = JSON.stringify({
    riskProfile: input.settings.riskProfile,
    plannedAmount: input.settings.plannedAmount,
    maxDrawdownTolerance: input.settings.maxDrawdownTolerance,
    targetReturn: input.settings.targetReturn,
    observationStatus: input.settings.observationStatus,
    buyCondition: input.settings.buyCondition,
    rejectCondition: input.settings.rejectCondition,
    reviewDate: input.settings.reviewDate,
    reviewNote: input.settings.reviewNote
  });
  const fundCode = input.targetType === "fund" ? code : null;
  const registerCode = input.targetType === "wealth" ? code : null;
  await prisma.watchlist.upsert({
    where: {
      targetType_targetKey: {
        targetType: input.targetType,
        targetKey: code
      }
    },
    update: {
      note
    },
    create: {
      targetType: input.targetType,
      targetKey: code,
      fundCode,
      registerCode,
      note
    }
  });
  return { watched: true };
}

export async function getAlertRulesForTarget(targetType: "fund" | "wealth", targetKey: string) {
  return prisma.alertRule.findMany({
    where: {
      targetType,
      targetKey
    },
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    take: 20
  });
}

export async function saveAlertRule(input: {
  targetType: "fund" | "wealth";
  targetKey: string;
  metric: string;
  threshold?: number | null;
  note?: string | null;
}) {
  const targetKey = input.targetKey.trim();
  if (!targetKey) {
    throw new Error("targetKey is required");
  }
  if (!["daily_drop", "take_profit", "peer_below", "position_over", "manager_change", "consecutive_drop", "peer_lag", "drawdown_new_high"].includes(input.metric)) {
    throw new Error("metric is invalid");
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

  const rule = await prisma.alertRule.create({
    data: {
      targetType: input.targetType,
      targetKey,
      fundCode: input.targetType === "fund" ? targetKey : null,
      registerCode: input.targetType === "wealth" ? targetKey : null,
      metric: input.metric,
      threshold: input.metric === "manager_change" ? null : (input.threshold ?? null),
      note: input.note ?? null,
      enabled: true
    }
  });
  alertCenterCache = null;
  return { rule };
}

export async function getAlertActionStates() {
  const rows = await prisma.alertAction.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500
  });
  const states: Record<string, AlertActionState | undefined> = {};
  for (const row of rows) {
    const state = normalizeAlertActionState({
      action: row.action,
      until: row.until ? row.until.toISOString().slice(0, 10) : undefined
    });
    if (state) {
      states[row.alertId] = state;
    }
  }
  return states;
}

export async function saveAlertAction(input: { alertId: string; action: unknown; until?: unknown; note?: string | null }) {
  const alertId = input.alertId.trim();
  const state = normalizeAlertActionState({ action: input.action, until: input.until });
  if (!alertId) {
    throw new Error("alertId is required");
  }
  if (!state) {
    throw new Error("alert action is invalid");
  }
  const until = state.action === "snooze" && state.until ? new Date(`${state.until}T00:00:00.000Z`) : null;
  const row = await prisma.alertAction.upsert({
    where: { alertId },
    update: {
      action: state.action,
      until,
      note: input.note ?? null
    },
    create: {
      alertId,
      action: state.action,
      until,
      note: input.note ?? null
    }
  });
  return { action: row };
}

export async function clearAlertActions() {
  await prisma.alertAction.deleteMany({});
  return { cleared: true };
}

export async function getCashDashboard() {
  const accounts = await prisma.cashAccount.findMany({
    include: {
      transactions: {
        orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
        take: 200
      }
    },
    orderBy: { updatedAt: "desc" }
  });
  const accountItems = accounts.map((account) => {
    const ledger = buildCashLedgerSummary(account.transactions);
    const openingValue = Number(account.openingValue ?? 0);
    return {
      id: account.id,
      name: account.name,
      currency: account.currency,
      openingValue,
      balance: Number((openingValue + ledger.balance).toFixed(2)),
      inflow: ledger.inflow,
      outflow: ledger.outflow,
      transactionCount: account.transactions.length,
      note: account.note
    };
  });
  return {
    accounts: accountItems,
    summary: {
      balance: accountItems.reduce((sum, item) => sum + item.balance, 0),
      inflow: accountItems.reduce((sum, item) => sum + item.inflow, 0),
      outflow: accountItems.reduce((sum, item) => sum + item.outflow, 0),
      accountCount: accountItems.length
    },
    transactions: accounts.flatMap((account) =>
      account.transactions.map((transaction) => ({
        ...transaction,
        accountName: account.name
      }))
    )
  };
}

export async function saveCashAccount(input: { name: string; openingValue?: number | null; note?: string | null }) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("cash account name is required");
  }
  return prisma.cashAccount.upsert({
    where: { name },
    update: {
      openingValue: input.openingValue ?? 0,
      note: input.note ?? null
    },
    create: {
      name,
      openingValue: input.openingValue ?? 0,
      note: input.note ?? null
    }
  });
}

export async function saveCashTransaction(input: {
  accountId: number;
  transactionType: string;
  transactionDate?: string | null;
  amount?: number | null;
  relatedTarget?: string | null;
  note?: string | null;
}) {
  const amount = Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("cash transaction amount must be positive");
  }
  if (!["deposit", "withdraw", "buy", "sell", "dividend", "fee", "interest", "transfer_in", "transfer_out"].includes(input.transactionType)) {
    throw new Error("cash transaction type is invalid");
  }
  return prisma.cashTransaction.create({
    data: {
      accountId: input.accountId,
      transactionType: input.transactionType,
      transactionDate: input.transactionDate ? new Date(input.transactionDate) : new Date(),
      amount,
      relatedTarget: input.relatedTarget ?? null,
      note: input.note ?? null
    }
  });
}

export async function getDecisionRecords(limit = 80) {
  const rows = await prisma.decisionRecord.findMany({
    orderBy: [{ status: "asc" }, { reviewDate: "asc" }, { createdAt: "desc" }],
    take: limit
  });
  const nowDate = new Date().toISOString().slice(0, 10);
  return rows.map((row) => ({
    ...row,
    reviewState: buildDecisionReviewState({
      reviewDate: row.reviewDate ? row.reviewDate.toISOString().slice(0, 10) : null,
      status: row.status
    }, nowDate)
  }));
}

export async function saveDecisionRecord(input: {
  targetType: "fund" | "wealth";
  targetKey: string;
  decisionType: string;
  reason?: string | null;
  plannedAmount?: number | null;
  reviewDate?: string | null;
}) {
  const targetKey = input.targetKey.trim();
  if (!targetKey) {
    throw new Error("targetKey is required");
  }
  if (!["buy", "reject", "watch", "sell_review"].includes(input.decisionType)) {
    throw new Error("decisionType is invalid");
  }
  return prisma.decisionRecord.create({
    data: {
      targetType: input.targetType,
      targetKey,
      decisionType: input.decisionType,
      reason: input.reason ?? null,
      plannedAmount: input.plannedAmount ?? null,
      reviewDate: input.reviewDate ? new Date(input.reviewDate) : null
    }
  });
}

export async function closeDecisionRecord(id: number, outcomeNote?: string | null) {
  return prisma.decisionRecord.update({
    where: { id },
    data: {
      status: "closed",
      outcomeNote: outcomeNote ?? null
    }
  });
}

export async function getPortfolioDashboard() {
  await ensureSqlitePragmas();
  const [holdings, targetRows, cash] = await Promise.all([
    prisma.portfolioHolding.findMany({
      orderBy: [{ targetType: "asc" }, { updatedAt: "desc" }],
      include: {
        fund: {
          include: {
            navs: { orderBy: { tradeDate: "desc" }, take: 2 },
            fees: { orderBy: [{ feeType: "asc" }, { id: "asc" }], take: 20 }
          }
        },
        product: {
          include: {
            navs: { orderBy: { navDate: "desc" }, take: 2 }
          }
        },
        transactions: {
          orderBy: [{ tradeDate: "desc" }, { id: "desc" }]
        }
      }
    }),
    prisma.portfolioTarget.findMany(),
    getCashDashboard()
  ]);

  function aggregateTransactions(
    transactions: Array<{
      transactionType: string;
      shares: number | null;
      price: number | null;
      amount: number | null;
      fee: number | null;
      tradeDate: Date;
    }>
  ) {
    const ordered = [...transactions].sort((a, b) => {
      const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
      return dateDiff === 0 ? 0 : dateDiff;
    });
    let shares = 0;
    let costBasis = 0;
    let totalInvested = 0;
    let realizedIncome = 0;
    let realizedProfit = 0;
    let dividendIncome = 0;
    let feeAmount = 0;
    for (const item of ordered) {
      const fee = item.fee ?? 0;
      const units = item.shares ?? (item.amount && item.price ? item.amount / item.price : 0);
      const amount = item.amount ?? (item.shares && item.price ? item.shares * item.price : 0);
      if (item.transactionType === "buy") {
        shares += units;
        costBasis += amount + fee;
        totalInvested += amount + fee;
        feeAmount += fee;
      } else if (item.transactionType === "sell") {
        const sellShares = Math.min(shares, units);
        const averageCost = shares > 0 ? costBasis / shares : 0;
        const removedCost = sellShares * averageCost;
        const proceeds = Math.max(0, amount - fee);
        shares = Math.max(0, shares - sellShares);
        costBasis = Math.max(0, costBasis - removedCost);
        realizedIncome += proceeds;
        realizedProfit += proceeds - removedCost;
        feeAmount += fee;
      } else if (item.transactionType === "dividend") {
        realizedIncome += amount;
        realizedProfit += amount;
        dividendIncome += amount;
      } else if (item.transactionType === "fee") {
        costBasis += amount;
        totalInvested += amount;
        feeAmount += amount;
      }
    }

    return {
      hasTransactions: transactions.length > 0,
      shares: shares > 0 ? shares : null,
      costAmount: costBasis,
      totalInvested,
      realizedIncome,
      realizedProfit,
      dividendIncome,
      feeAmount,
      transactionCount: transactions.length,
      latestTransactionDate: transactions[0]?.tradeDate ?? null
    };
  }

  const baseItems = holdings.map((holding) => {
    const latestFundNav = holding.fund?.navs[0];
    const previousFundNav = holding.fund?.navs[1];
    const latestWealthNav = holding.product?.navs[0];
    const previousWealthNav = holding.product?.navs[1];
    const latestPrice = latestFundNav?.unitNav ?? latestWealthNav?.netValue ?? null;
    const previousPrice = previousFundNav?.unitNav ?? previousWealthNav?.netValue ?? null;
    const transactionSummary = aggregateTransactions(holding.transactions);
    const reconciliation = buildHoldingReconciliation({
      manualShares: holding.shares,
      manualCostAmount: holding.costAmount,
      transactions: holding.transactions
    });
    const shares =
      transactionSummary.shares ??
      holding.shares ??
      (holding.costAmount && holding.costPrice && holding.costPrice > 0 ? holding.costAmount / holding.costPrice : null);
    const costAmount = transactionSummary.hasTransactions ? transactionSummary.costAmount : holding.costAmount;
    const currentValue = shares && latestPrice ? shares * latestPrice : costAmount;
    const unrealizedProfit = currentValue !== null && costAmount !== null ? currentValue - costAmount : null;
    const profit =
      unrealizedProfit !== null
        ? unrealizedProfit + (transactionSummary.hasTransactions ? transactionSummary.realizedProfit : 0)
        : null;
    const profitBase = transactionSummary.hasTransactions ? transactionSummary.totalInvested : costAmount;
    const profitRate = profit !== null && profitBase && profitBase > 0 ? (profit / profitBase) * 100 : null;
    const dailyProfit = shares && latestPrice && previousPrice ? shares * (latestPrice - previousPrice) : null;
    const dailyRate =
      latestFundNav?.dailyGrowthRate ??
      latestWealthNav?.dailyChangeRate ??
      (latestPrice && previousPrice ? (latestPrice / previousPrice - 1) * 100 : null);
    const feeSummary = holding.fund ? summarizeFeeRows(holding.fund.fees) : null;
    const holdingDays = daysBetween(holding.purchaseDate, latestFundNav?.tradeDate ?? latestWealthNav?.navDate ?? new Date());
    const estimatedRedemptionFee =
      holding.targetType === "fund" && costAmount && feeSummary?.redemptionRate !== null && feeSummary?.redemptionRate !== undefined
        ? costAmount * (feeSummary.redemptionRate / 100)
        : null;
    return {
      id: holding.id,
      targetType: holding.targetType,
      targetKey: holding.targetKey,
      name: holding.displayName ?? holding.fund?.name ?? holding.product?.name ?? holding.targetKey,
      issuer: holding.product?.issuer ?? holding.fund?.fundType ?? null,
      fundType: holding.fund?.fundType ?? null,
      shares,
      costAmount,
      costPrice: shares && costAmount && shares > 0 ? costAmount / shares : holding.costPrice,
      purchaseDate: holding.purchaseDate,
      holdingDays,
      latestPrice,
      currentValue,
      profit,
      unrealizedProfit,
      realizedProfit: transactionSummary.hasTransactions ? transactionSummary.realizedProfit : 0,
      profitRate,
      dailyProfit,
      dailyRate,
      estimatedRedemptionFee,
      redemptionRate: feeSummary?.redemptionRate ?? null,
      transactionCount: transactionSummary.transactionCount,
      totalInvested: transactionSummary.totalInvested,
      realizedIncome: transactionSummary.realizedIncome,
      dividendIncome: transactionSummary.dividendIncome,
      feeAmount: transactionSummary.feeAmount,
      reconciliation,
      latestTransactionDate: transactionSummary.latestTransactionDate,
      priceDate: latestFundNav?.tradeDate ?? latestWealthNav?.navDate ?? null,
      note: holding.note
    };
  });

  const summary = baseItems.reduce(
    (acc, item) => {
      acc.costAmount += item.costAmount ?? 0;
      acc.currentValue += item.currentValue ?? 0;
      acc.profit += item.profit ?? 0;
      acc.unrealizedProfit += item.unrealizedProfit ?? 0;
      acc.realizedProfit += item.realizedProfit ?? 0;
      acc.dailyProfit += item.dailyProfit ?? 0;
      acc.totalInvested += item.totalInvested ?? 0;
      acc.realizedIncome += item.realizedIncome ?? 0;
      acc.dividendIncome += item.dividendIncome ?? 0;
      acc.feeAmount += item.feeAmount ?? 0;
      acc.transactionCount += item.transactionCount ?? 0;
      return acc;
    },
    {
      costAmount: 0,
      currentValue: 0,
      profit: 0,
      unrealizedProfit: 0,
      realizedProfit: 0,
      dailyProfit: 0,
      totalInvested: 0,
      realizedIncome: 0,
      dividendIncome: 0,
      feeAmount: 0,
      transactionCount: 0
    }
  );
  const profitRate = summary.costAmount > 0 ? (summary.profit / summary.costAmount) * 100 : null;
  const items = baseItems.map((item) => ({
    ...item,
    positionWeight: summary.currentValue > 0 && item.currentValue ? (item.currentValue / summary.currentValue) * 100 : null
  }));
  const itemsWithSellChecks = items.map((item) => {
    const checks = [
      {
        label: "赎回费",
        status: item.redemptionRate !== null && item.redemptionRate > 0 ? "warn" : item.targetType === "fund" ? "ok" : "missing",
        detail:
          item.redemptionRate !== null
            ? `估算费率 ${item.redemptionRate.toFixed(2)}%，费用约 ${item.estimatedRedemptionFee?.toFixed(2) ?? "--"} 元`
            : "缺少赎回费率"
      },
      {
        label: "持有天数",
        status: item.holdingDays === null ? "missing" : item.holdingDays < 30 ? "warn" : "ok",
        detail: item.holdingDays === null ? "缺少买入日期" : `已持有约 ${item.holdingDays} 天`
      },
      {
        label: "盈亏状态",
        status: item.profitRate !== null && item.profitRate <= -10 ? "warn" : item.profitRate === null ? "missing" : "ok",
        detail: item.profitRate === null ? "缺少成本或市值" : `当前累计收益率 ${item.profitRate.toFixed(2)}%`
      },
      {
        label: "短期波动",
        status: item.dailyRate !== null && item.dailyRate <= -3 ? "warn" : item.dailyRate === null ? "missing" : "ok",
        detail: item.dailyRate === null ? "缺少相邻净值" : `最新日涨跌 ${item.dailyRate.toFixed(2)}%`
      },
      {
        label: "仓位占比",
        status: item.positionWeight !== null && item.positionWeight >= 30 ? "warn" : item.positionWeight === null ? "missing" : "ok",
        detail: item.positionWeight === null ? "无法计算仓位" : `组合占比 ${item.positionWeight.toFixed(1)}%`
      },
      {
        label: "流水完整度",
        status: item.transactionCount > 0 ? "ok" : "missing",
        detail: item.transactionCount > 0 ? `${item.transactionCount} 条交易流水` : "未录入真实交易流水"
      }
    ];
    const warnCount = checks.filter((check) => check.status === "warn").length;
    const missingCount = checks.filter((check) => check.status === "missing").length;
    return {
      ...item,
      sellCheck: {
        level: warnCount >= 2 ? "high" : warnCount === 1 || missingCount >= 2 ? "medium" : "low",
        summary:
          warnCount > 0
            ? `赎回前需重点核对 ${warnCount} 项风险`
            : missingCount > 0
              ? `赎回前先补齐 ${missingCount} 项信息`
              : "赎回前基础信息较完整",
        checks
      }
    };
  });

  const fundCodes = itemsWithSellChecks.filter((item) => item.targetType === "fund").map((item) => item.targetKey);
  const [stockRows, industryRows] = fundCodes.length
    ? await Promise.all([
        prisma.fundHolding.findMany({
          where: { fundCode: { in: fundCodes }, ratio: { not: null } },
          orderBy: [{ fundCode: "asc" }, { reportPeriod: "desc" }, { ratio: "desc" }],
          take: fundCodes.length * 80
        }),
        prisma.fundIndustryAllocation.findMany({
          where: { fundCode: { in: fundCodes }, ratio: { not: null } },
          orderBy: [{ fundCode: "asc" }, { reportDate: "desc" }, { ratio: "desc" }],
          take: fundCodes.length * 80
        })
      ])
    : [[], []];

  const fundWeights = new Map(
    itemsWithSellChecks
      .filter((item) => item.targetType === "fund" && item.positionWeight !== null)
      .map((item) => [item.targetKey, Number(item.positionWeight) / 100])
  );

  const latestStockPeriod = new Map<string, string>();
  for (const row of stockRows) {
    if (!latestStockPeriod.has(row.fundCode)) {
      latestStockPeriod.set(row.fundCode, row.reportPeriod);
    }
  }
  const stockExposure = new Map<string, { stockCode: string; stockName: string; exposure: number; fundCount: number; funds: Set<string> }>();
  for (const row of stockRows) {
    if (latestStockPeriod.get(row.fundCode) !== row.reportPeriod || row.ratio === null) {
      continue;
    }
    const fundWeight = fundWeights.get(row.fundCode) ?? 0;
    const exposure = fundWeight * row.ratio;
    const key = row.stockCode || row.stockName;
    const item =
      stockExposure.get(key) ??
      { stockCode: row.stockCode, stockName: row.stockName, exposure: 0, fundCount: 0, funds: new Set<string>() };
    item.exposure += exposure;
    item.funds.add(row.fundCode);
    item.fundCount = item.funds.size;
    stockExposure.set(key, item);
  }

  const latestIndustryDate = new Map<string, string>();
  for (const row of industryRows) {
    const date = row.reportDate.toISOString();
    if (!latestIndustryDate.has(row.fundCode)) {
      latestIndustryDate.set(row.fundCode, date);
    }
  }
  const industryExposure = new Map<string, { industryName: string; exposure: number; fundCount: number; funds: Set<string> }>();
  for (const row of industryRows) {
    const date = row.reportDate.toISOString();
    if (latestIndustryDate.get(row.fundCode) !== date || row.ratio === null) {
      continue;
    }
    const fundWeight = fundWeights.get(row.fundCode) ?? 0;
    const exposure = fundWeight * row.ratio;
    const item =
      industryExposure.get(row.industryName) ??
      { industryName: row.industryName, exposure: 0, fundCount: 0, funds: new Set<string>() };
    item.exposure += exposure;
    item.funds.add(row.fundCode);
    item.fundCount = item.funds.size;
    industryExposure.set(row.industryName, item);
  }

  const topPositions = [...itemsWithSellChecks]
    .filter((item) => item.positionWeight !== null)
    .sort((a, b) => Number(b.positionWeight) - Number(a.positionWeight))
    .slice(0, 5);
  const topStocks = [...stockExposure.values()]
    .map((item) => ({ ...item, funds: undefined }))
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 8);
  const overlappingStocks = [...stockExposure.values()]
    .filter((item) => item.fundCount >= 2)
    .map((item) => ({ ...item, funds: undefined }))
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 8);
  const topIndustries = [...industryExposure.values()]
    .map((item) => ({ ...item, funds: undefined }))
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 8);
  const concentrationWarnings: string[] = [];
  const largestPosition = topPositions[0];
  if (largestPosition?.positionWeight && largestPosition.positionWeight >= 40) {
    concentrationWarnings.push(`${largestPosition.name} 占组合约 ${largestPosition.positionWeight.toFixed(1)}%，单一持仓较集中。`);
  }
  const largestIndustry = topIndustries[0];
  if (largestIndustry && largestIndustry.exposure >= 35) {
    concentrationWarnings.push(`${largestIndustry.industryName} 暴露约 ${largestIndustry.exposure.toFixed(1)}%，行业集中度较高。`);
  }
  const largestOverlap = overlappingStocks[0];
  if (largestOverlap && largestOverlap.exposure >= 8) {
    concentrationWarnings.push(`${largestOverlap.stockName} 被 ${largestOverlap.fundCount} 只基金共同持有，组合穿透暴露约 ${largestOverlap.exposure.toFixed(1)}%。`);
  }
  const targetByKey = new Map(targetRows.map((target) => [target.targetKey, target]));
  const mergedTargets = DEFAULT_PORTFOLIO_TARGETS.map((target) => ({
    ...target,
    ...(targetByKey.get(target.targetKey) ?? {})
  }));
  const fundMarketValue = items.filter((item) => item.targetType === "fund").reduce((sum, item) => sum + (item.currentValue ?? 0), 0);
  const wealthMarketValue = items.filter((item) => item.targetType === "wealth").reduce((sum, item) => sum + (item.currentValue ?? 0), 0);
  const totalWithCash = summary.currentValue + cash.summary.balance;
  const fundWeight = totalWithCash > 0 ? (fundMarketValue / totalWithCash) * 100 : 0;
  const wealthWeight = totalWithCash > 0 ? (wealthMarketValue / totalWithCash) * 100 : 0;
  const cashWeight = totalWithCash > 0 ? (cash.summary.balance / totalWithCash) * 100 : 0;
  const currentWeightByKey = new Map<string, number>([
    ["fund", fundWeight],
    ["wealth", wealthWeight],
    ["cash", cashWeight],
    ["single_position", largestPosition?.positionWeight ?? 0],
    ["industry", largestIndustry?.exposure ?? 0]
  ]);
  const targetPlan = mergedTargets.map((target) => {
    const currentWeight = currentWeightByKey.get(target.targetKey) ?? 0;
    const targetWeight = target.targetWeight ?? null;
    const maxWeight = target.maxWeight ?? null;
    const deviation = targetWeight !== null ? currentWeight - targetWeight : null;
    const overLimit = maxWeight !== null && currentWeight > maxWeight;
    const offTarget = deviation !== null && Math.abs(deviation) >= 5;
    return {
      id: "id" in target ? target.id : null,
      targetKey: target.targetKey,
      label: target.label,
      targetWeight,
      maxWeight,
      currentWeight,
      deviation,
      note: target.note,
      status: overLimit ? "over" : offTarget ? "off" : "ok"
    };
  });
  const rebalancePlan = buildRebalancePlan({
    totalValue: totalWithCash,
    targets: targetPlan.map((target) => ({
      key: target.targetKey,
      label: target.label,
      currentWeight: target.currentWeight,
      targetWeight: target.targetWeight,
      maxWeight: target.maxWeight
    })),
    driftThresholdPercent: 5
  });

  return {
    items: itemsWithSellChecks,
    summary: {
      ...summary,
      profitRate,
      holdingCount: items.length,
      fundMarketValue,
      wealthMarketValue,
      cashValue: cash.summary.balance,
      totalValue: totalWithCash
    },
    concentration: {
      topPositions,
      topStocks,
      overlappingStocks,
      topIndustries,
      warnings: concentrationWarnings
    },
    targetPlan,
    rebalancePlan,
    cash,
    transactions: holdings
      .flatMap((holding) =>
        holding.transactions.map((transaction) => ({
          id: transaction.id,
          targetType: holding.targetType,
          targetKey: holding.targetKey,
          name: holding.displayName ?? holding.fund?.name ?? holding.product?.name ?? holding.targetKey,
          transactionType: transaction.transactionType,
          tradeDate: transaction.tradeDate,
          shares: transaction.shares,
          price: transaction.price,
          amount: transaction.amount,
          fee: transaction.fee,
          note: transaction.note
        }))
      )
      .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime())
      .slice(0, 80)
  };
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

export async function savePortfolioTransaction(input: {
  targetType: "fund" | "wealth";
  targetKey: string;
  transactionType: string;
  tradeDate?: string | null;
  shares?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
  note?: string | null;
}) {
  const targetKey = input.targetKey.trim();
  if (!targetKey) {
    throw new Error("targetKey is required");
  }
  if (!["buy", "sell", "dividend", "fee"].includes(input.transactionType)) {
    throw new Error("transactionType must be buy, sell, dividend or fee");
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

  const tradeDate = input.tradeDate ? new Date(input.tradeDate) : new Date();
  if (Number.isNaN(tradeDate.getTime())) {
    throw new Error("交易日期无效");
  }

  const nextSignature = buildTransactionSignature({
    targetType: input.targetType,
    targetKey,
    transactionType: input.transactionType,
    tradeDate,
    shares: input.shares,
    price: input.price,
    amount: input.amount,
    fee: input.fee
  });

  return prisma.$transaction(async (tx) => {
    const holding = await tx.portfolioHolding.upsert({
      where: {
        targetType_targetKey: {
          targetType: input.targetType,
          targetKey
        }
      },
      update: {
        displayName: fund?.name ?? product?.name ?? null
      },
      create: {
        targetType: input.targetType,
        targetKey,
        fundCode: input.targetType === "fund" ? targetKey : null,
        registerCode: input.targetType === "wealth" ? targetKey : null,
        displayName: fund?.name ?? product?.name ?? null
      }
    });

    const existing = await tx.portfolioTransaction.findMany({
      where: {
        holdingId: holding.id,
        transactionType: input.transactionType,
        tradeDate: {
          gte: new Date(`${tradeDate.toISOString().slice(0, 10)}T00:00:00.000Z`),
          lt: new Date(`${tradeDate.toISOString().slice(0, 10)}T23:59:59.999Z`)
        }
      },
      orderBy: { id: "asc" }
    });
    const duplicate = existing.find((transaction) =>
      buildTransactionSignature({
        targetType: transaction.targetType,
        targetKey: transaction.targetKey,
        transactionType: transaction.transactionType,
        tradeDate: transaction.tradeDate,
        shares: transaction.shares,
        price: transaction.price,
        amount: transaction.amount,
        fee: transaction.fee
      }) === nextSignature
    );
    if (duplicate) {
      return { ...duplicate, duplicate: true };
    }

    return tx.portfolioTransaction.create({
      data: {
        holdingId: holding.id,
        targetType: input.targetType,
        targetKey,
        transactionType: input.transactionType,
        tradeDate,
        shares: input.shares ?? null,
        price: input.price ?? null,
        amount: input.amount ?? null,
        fee: input.fee ?? null,
        note: input.note ?? null
      }
    });
  });
}

export async function deletePortfolioTransaction(id: number) {
  await prisma.portfolioTransaction.deleteMany({ where: { id } });
  return { deleted: true };
}

export async function savePortfolioTargets(input: Array<{
  targetKey: string;
  label: string;
  targetWeight?: number | null;
  maxWeight?: number | null;
  note?: string | null;
}>) {
  const rows = input.filter((item) => item.targetKey && item.label);
  await prisma.$transaction(
    rows.map((item) =>
      prisma.portfolioTarget.upsert({
        where: { targetKey: item.targetKey },
        update: {
          label: item.label,
          targetWeight: item.targetWeight ?? null,
          maxWeight: item.maxWeight ?? null,
          note: item.note ?? null
        },
        create: {
          targetKey: item.targetKey,
          label: item.label,
          targetWeight: item.targetWeight ?? null,
          maxWeight: item.maxWeight ?? null,
          note: item.note ?? null
        }
      })
    )
  );
  return { saved: rows.length };
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
  return {
    items: items.map((item) => ({ ...item, impact: classifyAnnouncementImpact(item.title, item.source) })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
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
  const normalized = parseCompareTargets(targets.join(",")).map((item) => {
    const [targetType, targetKey] = item.split(":");
    return { targetType, targetKey };
  });

  const items = [];
  for (const target of normalized) {
    if (target.targetType === "fund") {
      const detail = await getFundDetail(target.targetKey);
      if (!detail) {
        continue;
      }
      const latest = detail.navs.at(-1);
      const feeSummary = summarizeFeeRows(detail.fees);
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
        fee: detail.fees[0]?.feeValue ?? null,
        feeCost365d: estimateKnownFeeCost(feeSummary, 365, 10000),
        dataScore: detail.dataCoverage.score
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
        fee: detail.feeSummary,
        feeCost365d: null,
        dataScore: latest ? 60 : 30
      });
    }
  }

  return { items };
}

export async function getAlertCenter(): Promise<AlertCenterResult> {
  const now = new Date().toISOString();
  if (alertCenterCache && isSnapshotFresh(alertCenterCache.generatedAt, now, 10)) {
    return alertCenterCache.result;
  }
  const [watched, holdings, rules, portfolioSnapshot] = await Promise.all([
    prisma.watchlist.findMany({ take: 80 }),
    prisma.portfolioHolding.findMany({ take: 80 }),
    prisma.alertRule.findMany({ where: { enabled: true }, orderBy: [{ createdAt: "desc" }], take: 200 }),
    getPortfolioQuickSnapshot()
  ]);
  const fundCodes = Array.from(
    new Set([
      ...watched.map((item) => item.fundCode).filter(Boolean),
      ...holdings.map((item) => item.fundCode).filter(Boolean),
      ...rules
        .filter((item) => item.targetType === "fund")
        .map((item) => item.fundCode ?? item.targetKey)
        .filter(Boolean)
    ] as string[])
  ).slice(0, 50);
  const wealthCodes = Array.from(
    new Set([
      ...watched.map((item) => item.registerCode).filter(Boolean),
      ...holdings.map((item) => item.registerCode).filter(Boolean),
      ...rules
        .filter((item) => item.targetType === "wealth")
        .map((item) => item.registerCode ?? item.targetKey)
        .filter(Boolean)
    ] as string[])
  ).slice(0, 50);
  const rulesByTarget = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = `${rule.targetType}:${rule.targetKey ?? rule.fundCode ?? rule.registerCode ?? ""}`;
    const bucket = rulesByTarget.get(key) ?? [];
    bucket.push(rule);
    rulesByTarget.set(key, bucket);
  }
  const portfolioByTarget = new Map(portfolioSnapshot.map((item) => [`${item.targetType}:${item.targetKey}`, item]));

  const alerts: AlertItem[] = [];
  for (const code of fundCodes) {
    const detail = await getFundDetail(code);
    if (detail) {
      alerts.push(...detail.warnings);
      const latestNav = detail.navs.at(-1);
      const oneYearReturn = detail.periodReturns.find((item) => item.rangeKey === "year_1");
      const portfolioItem = portfolioByTarget.get(`fund:${code}`);
      const highImpactAnnouncementCount = detail.announcements.filter((item) => item.impact?.level === "high").length;
      for (const rule of rulesByTarget.get(`fund:${code}`) ?? []) {
        const basicTriggered = evaluateUserAlertRule(rule, {
          dailyRate: latestNav?.dailyGrowthRate ?? null,
          profitRate: portfolioItem?.profitRate ?? null,
          peerPercentile: oneYearReturn?.peerPercentile ?? null,
          positionWeight: portfolioItem?.positionWeight ?? null,
          highImpactAnnouncementCount
        });
        const advancedTriggered = evaluateAdvancedAlertRule(rule, {
          recentDailyRates: detail.navs.slice(-5).map((item) => item.dailyGrowthRate),
          returnValue: oneYearReturn?.rankValue ?? null,
          peerMedianReturn: oneYearReturn?.rankValue !== null && oneYearReturn?.rankValue !== undefined ? Number(oneYearReturn.rankValue) + 10 : null,
          maxDrawdown: detail.riskMetrics.maxDrawdown,
          previousMaxDrawdown: null,
          positionWeight: portfolioItem?.positionWeight ?? null
        });
        const triggered = basicTriggered ?? advancedTriggered;
        if (triggered) {
          alerts.push({
            level: triggered.level,
            targetType: "fund",
            targetKey: code,
            title: triggered.title,
            message: `${triggered.message}${rule.note ? ` ${rule.note}` : ""}`,
            metric: `rule:${rule.metric}`
          });
        }
      }
    }
  }
  for (const code of wealthCodes) {
    const detail = await getWealthProductDetail(code);
    if (detail) {
      alerts.push(...detail.warnings);
      const portfolioItem = portfolioByTarget.get(`wealth:${code}`);
      const latestNav = detail.navs.at(-1);
      for (const rule of rulesByTarget.get(`wealth:${code}`) ?? []) {
        const triggered = evaluateUserAlertRule(rule, {
          dailyRate: latestNav?.dailyChangeRate ?? null,
          profitRate: portfolioItem?.profitRate ?? null,
          positionWeight: portfolioItem?.positionWeight ?? null,
          highImpactAnnouncementCount: 0
        });
        if (triggered) {
          alerts.push({
            level: triggered.level,
            targetType: "wealth",
            targetKey: code,
            title: triggered.title,
            message: `${triggered.message}${rule.note ? ` ${rule.note}` : ""}`,
            metric: `rule:${rule.metric}`
          });
        }
      }
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
  const result = { items: alerts.sort((a, b) => order[a.level] - order[b.level]) };
  alertCenterCache = { generatedAt: now, result };
  return result;
}
