import type { FundAssetMode } from "@/lib/fund-classification";

export type CoverageCheckStatus = "ok" | "warn" | "missing";

export type FundDataCoverageInput = {
  navSampleCount: number;
  latestNavDate?: Date | string | null;
  periodReturnCount: number;
  hasProfile: boolean;
  hasFee: boolean;
  hasRating: boolean;
  stockHoldingCount: number;
  bondHoldingCount: number;
  industryCount: number;
  announcementCount: number;
  hasMoneyData?: boolean;
  hasExchangeQuote?: boolean;
  assetMode: FundAssetMode;
};

export type FundDataCoverage = {
  score: number;
  level: "high" | "medium" | "low";
  label: string;
  summary: string;
  navCoverageLabel: string;
  staleDays: number | null;
  checks: Array<{
    key: string;
    label: string;
    status: CoverageCheckStatus;
    detail: string;
  }>;
  missingActions: string[];
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value: Date | string | null | undefined) {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function navScore(count: number) {
  if (count >= 720) return 35;
  if (count >= 500) return 30;
  if (count >= 240) return 25;
  if (count >= 120) return 18;
  if (count >= 60) return 12;
  if (count >= 14) return 8;
  return 0;
}

function navLabel(count: number) {
  if (count >= 720) return "约 3 年以上";
  if (count >= 500) return "约 2 年以上";
  if (count >= 240) return "约 1 年以上";
  if (count >= 60) return "约 3 个月以上";
  if (count >= 14) return "约 2 周以上";
  if (count > 0) return "少量样本";
  return "无净值样本";
}

export function buildFundDataCoverage(input: FundDataCoverageInput): FundDataCoverage {
  const staleDays = daysSince(input.latestNavDate);
  const checks: FundDataCoverage["checks"] = [];
  const missingActions: string[] = [];
  let score = navScore(input.navSampleCount);

  checks.push({
    key: "nav",
    label: "历史净值",
    status: input.navSampleCount >= 240 ? "ok" : input.navSampleCount >= 14 ? "warn" : "missing",
    detail: `${input.navSampleCount} 条，${navLabel(input.navSampleCount)}`
  });
  if (input.navSampleCount < 240) {
    missingActions.push("补齐至少 1 年历史净值");
  }

  if (staleDays !== null) {
    if (staleDays <= 5) score += 10;
    else if (staleDays <= 15) score += 5;
    checks.push({
      key: "freshness",
      label: "最新净值",
      status: staleDays <= 5 ? "ok" : staleDays <= 15 ? "warn" : "missing",
      detail: staleDays <= 0 ? "今天有记录" : `${staleDays} 天前更新`
    });
  } else {
    checks.push({ key: "freshness", label: "最新净值", status: "missing", detail: "缺少净值日期" });
    missingActions.push("补最新净值");
  }

  if (input.periodReturnCount >= 5) score += 12;
  else if (input.periodReturnCount >= 2) score += 6;
  checks.push({
    key: "returns",
    label: "阶段收益",
    status: input.periodReturnCount >= 5 ? "ok" : input.periodReturnCount > 0 ? "warn" : "missing",
    detail: `${input.periodReturnCount} 个周期有收益数据`
  });
  if (input.periodReturnCount < 5) {
    missingActions.push("补多周期收益排行");
  }

  if (input.hasProfile) score += 12;
  checks.push({
    key: "profile",
    label: "基金资料",
    status: input.hasProfile ? "ok" : "missing",
    detail: input.hasProfile ? "已采集公司、经理、规模等资料" : "缺少画像资料"
  });
  if (!input.hasProfile) missingActions.push("补基金画像");

  if (input.hasFee) score += 10;
  checks.push({
    key: "fee",
    label: "费率",
    status: input.hasFee ? "ok" : "missing",
    detail: input.hasFee ? "已采集申购、赎回、管理等费率" : "缺少费率"
  });
  if (!input.hasFee) missingActions.push("补费率");

  const needsStock = input.assetMode === "open" || input.assetMode === "exchange" || input.assetMode === "qdii";
  const needsBond = input.assetMode === "open" || input.assetMode === "fof";
  const hasHolding = input.stockHoldingCount > 0 || input.bondHoldingCount > 0 || input.industryCount > 0;
  if (hasHolding) score += 11;
  checks.push({
    key: "holding",
    label: "持仓/行业",
    status: hasHolding ? "ok" : needsStock || needsBond ? "missing" : "warn",
    detail: `股票 ${input.stockHoldingCount}，债券 ${input.bondHoldingCount}，行业 ${input.industryCount}`
  });
  if (!hasHolding && (needsStock || needsBond)) missingActions.push("补持仓和行业配置");

  if (input.hasRating) score += 5;
  checks.push({
    key: "rating",
    label: "评级",
    status: input.hasRating ? "ok" : "warn",
    detail: input.hasRating ? "已有评级记录" : "评级源暂缺，不影响净值计算"
  });

  if (input.announcementCount > 0) score += 5;
  checks.push({
    key: "announcement",
    label: "公告",
    status: input.announcementCount > 0 ? "ok" : "warn",
    detail: `${input.announcementCount} 条公告`
  });

  if (input.assetMode === "money") {
    if (input.hasMoneyData) score += 10;
    checks.push({
      key: "money",
      label: "货币基金专属数据",
      status: input.hasMoneyData ? "ok" : "missing",
      detail: input.hasMoneyData ? "已有万份收益/七日年化" : "需补万份收益和七日年化"
    });
    if (!input.hasMoneyData) missingActions.push("补货币基金万份收益/七日年化");
  }

  if (input.assetMode === "exchange") {
    if (input.hasExchangeQuote) score += 10;
    checks.push({
      key: "exchange",
      label: "场内行情",
      status: input.hasExchangeQuote ? "ok" : "missing",
      detail: input.hasExchangeQuote ? "已有价格、成交额、折溢价" : "需补 ETF/LOF 场内行情"
    });
    if (!input.hasExchangeQuote) missingActions.push("补 ETF/LOF 场内行情");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const level = boundedScore >= 80 ? "high" : boundedScore >= 55 ? "medium" : "low";
  const label = level === "high" ? "高" : level === "medium" ? "中" : "低";
  const summary =
    level === "high"
      ? "数据较完整，可用于买前比较和持有复盘"
      : level === "medium"
        ? "核心净值可用，但买前仍要补资料或持仓"
        : "数据缺口较大，建议先补数再做判断";

  return {
    score: boundedScore,
    level,
    label,
    summary,
    navCoverageLabel: navLabel(input.navSampleCount),
    staleDays,
    checks,
    missingActions: Array.from(new Set(missingActions))
  };
}
