export type ObservationTier = "strong" | "watchable" | "cautious";

export type CandidateTierInput = {
  observationScore: number;
};

export type FeeSummaryLike = {
  subscriptionRate?: number | null;
  serviceRate?: number | null;
  managementRate?: number | null;
  custodyRate?: number | null;
  redemptionRate?: number | null;
};

export type DailyHighlight = {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
  href?: string;
};

export const STRONG_CANDIDATE_LIMIT = 60;
export const WATCHABLE_CANDIDATE_LIMIT = 220;

export function candidateTierForRank(score: number, rankIndex: number): ObservationTier {
  if (rankIndex < STRONG_CANDIDATE_LIMIT && score >= 75) {
    return "strong";
  }
  if (rankIndex < WATCHABLE_CANDIDATE_LIMIT && score >= 60) {
    return "watchable";
  }
  return "cautious";
}

export function assignCandidateTiers<T extends CandidateTierInput>(items: T[]) {
  return items.map((item, index) => ({
    ...item,
    observationTier: candidateTierForRank(item.observationScore, index)
  }));
}

export function formatSampleScope(input: { recentCount: number | null | undefined; totalCount?: number | null | undefined }) {
  const recentCount = Math.max(0, Number(input.recentCount ?? 0));
  const totalCount = Math.max(recentCount, Number(input.totalCount ?? recentCount));
  if (totalCount > recentCount) {
    return `近一年样本 ${recentCount} 条 / 全历史 ${totalCount} 条`;
  }
  return `样本 ${recentCount} 条`;
}

function isKnownRate(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function hasKnownFeeRate(summary: FeeSummaryLike | null | undefined) {
  if (!summary) {
    return false;
  }
  return (
    isKnownRate(summary.subscriptionRate) ||
    isKnownRate(summary.serviceRate) ||
    isKnownRate(summary.managementRate) ||
    isKnownRate(summary.custodyRate) ||
    isKnownRate(summary.redemptionRate)
  );
}

export function estimateKnownFeeCost(summary: FeeSummaryLike | null | undefined, days: number, amount: number) {
  if (!summary || !hasKnownFeeRate(summary)) {
    return null;
  }
  const subscriptionCost = amount * ((summary.subscriptionRate ?? 0) / 100);
  const serviceCost = amount * ((summary.serviceRate ?? 0) / 100) * (days / 365);
  const managementCost = amount * ((summary.managementRate ?? 0) / 100) * (days / 365);
  const custodyCost = amount * ((summary.custodyRate ?? 0) / 100) * (days / 365);
  return subscriptionCost + serviceCost + managementCost + custodyCost;
}

export function parseCompareTargets(value: string | null | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of (value ?? "").split(/[,，;；\n\r]+/)) {
    const raw = token.trim();
    if (!raw) {
      continue;
    }
    const normalized = raw.toLowerCase().startsWith("fund:")
      ? `fund:${raw.slice(raw.indexOf(":") + 1).trim()}`
      : raw.toLowerCase().startsWith("wealth:")
        ? `wealth:${raw.slice(raw.indexOf(":") + 1).trim()}`
        : /^[0-9]{6}$/.test(raw)
          ? `fund:${raw}`
          : `wealth:${raw}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
    if (result.length >= 8) {
      break;
    }
  }
  return result;
}

export function getDecisionQueueMissingFields(settings: {
  buyCondition?: string | null;
  rejectCondition?: string | null;
  reviewDate?: string | null;
}) {
  const missing: string[] = [];
  if (!settings.buyCondition?.trim()) {
    missing.push("买入条件");
  }
  if (!settings.rejectCondition?.trim()) {
    missing.push("放弃条件");
  }
  if (!settings.reviewDate?.trim()) {
    missing.push("复盘日期");
  }
  return missing;
}

function daysBetweenIso(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) {
    return null;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

export function buildDailyHighlights(input: {
  fundNavDate?: string | null;
  asOfDate?: string | null;
  newStrongCandidates?: number;
  watchedMoves?: Array<{ code: string; name: string; dailyGrowthRate: number | null }>;
  rankingMoves?: Array<{ code: string; name: string; rangeLabel: string; rankValue: number | null }>;
  latestSyncStatus?: string | null;
}): DailyHighlight[] {
  const highlights: DailyHighlight[] = [];
  const watchedMoves = (input.watchedMoves ?? [])
    .filter((item) => item.dailyGrowthRate !== null && item.dailyGrowthRate !== undefined && Math.abs(item.dailyGrowthRate) >= 2.5)
    .sort((a, b) => Math.abs(b.dailyGrowthRate ?? 0) - Math.abs(a.dailyGrowthRate ?? 0));

  if (watchedMoves.length) {
    const first = watchedMoves[0];
    highlights.push({
      level: Math.abs(first.dailyGrowthRate ?? 0) >= 3 ? "high" : "medium",
      title: "关注基金波动需要复核",
      detail: `${first.name} 最新日涨跌幅 ${Number(first.dailyGrowthRate).toFixed(2)}%，共 ${watchedMoves.length} 只关注基金触发波动提醒。`,
      href: "/funds/watchlist"
    });
  }

  if ((input.newStrongCandidates ?? 0) > 0) {
    highlights.push({
      level: "medium",
      title: "新增重点观察候选",
      detail: `当前重点观察池有 ${input.newStrongCandidates} 只基金，建议优先看回撤、费用和申购状态。`,
      href: "/funds/candidates?grade=strong"
    });
  }

  const rankingMove = input.rankingMoves?.find((item) => item.rankValue !== null && item.rankValue !== undefined);
  if (rankingMove) {
    highlights.push({
      level: "low",
      title: "收益排名有新变化",
      detail: `${rankingMove.name} ${rankingMove.rangeLabel}收益 ${Number(rankingMove.rankValue).toFixed(2)}%，可加入对比复核。`,
      href: `/funds/${encodeURIComponent(rankingMove.code)}`
    });
  }

  const staleDays = daysBetweenIso(input.fundNavDate, input.asOfDate ?? new Date().toISOString());
  if (staleDays !== null) {
    highlights.push({
      level: staleDays > 1 ? "medium" : "low",
      title: staleDays > 1 ? "基金净值数据可能滞后" : "基金净值已更新",
      detail: staleDays > 1 ? `最新基金净值日距当前日期 ${staleDays} 天。` : `最新基金净值日为 ${input.fundNavDate?.slice(0, 10)}。`,
      href: "/sync"
    });
  }

  if (input.latestSyncStatus && input.latestSyncStatus !== "success") {
    highlights.push({
      level: "high",
      title: "最近同步未完全成功",
      detail: `最近同步状态为 ${input.latestSyncStatus}，建议先查看数据任务。`,
      href: "/sync"
    });
  }

  const priority = { high: 0, medium: 1, low: 2 };
  return highlights.sort((a, b) => priority[a.level] - priority[b.level]).slice(0, 5);
}

export type InvestmentPreferences = {
  riskProfile: "conservative" | "balanced" | "aggressive";
  plannedAmount: number;
  maxDrawdownTolerance: number;
  targetReturn: number;
  maxPositionWeight: number;
};

export function normalizeInvestmentPreferences(input: Partial<InvestmentPreferences> | null | undefined): InvestmentPreferences {
  const riskProfile =
    input?.riskProfile === "conservative" || input?.riskProfile === "aggressive" || input?.riskProfile === "balanced"
      ? input.riskProfile
      : "balanced";
  const plannedAmount = Number.isFinite(Number(input?.plannedAmount)) && Number(input?.plannedAmount) > 0 ? Number(input?.plannedAmount) : 10000;
  const maxDrawdownTolerance =
    Number.isFinite(Number(input?.maxDrawdownTolerance)) && Number(input?.maxDrawdownTolerance) > 0
      ? Number(input?.maxDrawdownTolerance)
      : 15;
  const targetReturn = Number.isFinite(Number(input?.targetReturn)) ? Number(input?.targetReturn) : 8;
  const defaultMaxPositionWeight = riskProfile === "conservative" ? 15 : riskProfile === "aggressive" ? 35 : 25;
  const maxPositionWeight =
    Number.isFinite(Number(input?.maxPositionWeight)) && Number(input?.maxPositionWeight) > 0
      ? Number(input?.maxPositionWeight)
      : defaultMaxPositionWeight;

  return {
    riskProfile,
    plannedAmount,
    maxDrawdownTolerance,
    targetReturn,
    maxPositionWeight
  };
}

export type WatchlistStatus = "researching" | "waiting_pullback" | "ready_to_buy" | "bought" | "rejected";

const watchlistStatuses: WatchlistStatus[] = ["researching", "waiting_pullback", "ready_to_buy", "bought", "rejected"];

export function normalizeWatchlistStatus(value: unknown): WatchlistStatus {
  return watchlistStatuses.includes(value as WatchlistStatus) ? (value as WatchlistStatus) : "researching";
}

export function groupWatchlistDecisions<T extends { observationStatus?: unknown; reviewDate?: string | null }>(items: T[]) {
  const grouped = {
    researching: [] as T[],
    waiting_pullback: [] as T[],
    ready_to_buy: [] as T[],
    bought: [] as T[],
    rejected: [] as T[]
  };
  for (const item of items) {
    grouped[normalizeWatchlistStatus(item.observationStatus)].push(item);
  }
  for (const key of watchlistStatuses) {
    grouped[key].sort((a, b) => String(a.reviewDate ?? "9999-12-31").localeCompare(String(b.reviewDate ?? "9999-12-31")));
  }
  return grouped;
}

export type AlertActionState = {
  action: "done" | "snooze" | "reject";
  until?: string | null;
};

export function applyAlertActionState<T extends { id: string }>(
  alerts: T[],
  states: Record<string, AlertActionState | undefined>,
  nowDate = new Date().toISOString().slice(0, 10)
) {
  return alerts.filter((alert) => {
    const state = states[alert.id];
    if (!state) {
      return true;
    }
    if (state.action === "done" || state.action === "reject") {
      return false;
    }
    if (state.action === "snooze") {
      return !state.until || state.until <= nowDate;
    }
    return true;
  });
}

export function getComparisonWinnerKeys(
  values: Array<{ key: string; value: number | null | undefined }>,
  direction: "higher" | "lower" | "lowerAbs"
) {
  const usable = values.filter((item): item is { key: string; value: number } => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  if (!usable.length) {
    return [];
  }
  const score = (value: number) => (direction === "lowerAbs" ? Math.abs(value) : value);
  const target =
    direction === "higher"
      ? Math.max(...usable.map((item) => score(item.value)))
      : Math.min(...usable.map((item) => score(item.value)));
  return usable.filter((item) => score(item.value) === target).map((item) => item.key);
}

export function getResponsiveTableMode(width: number) {
  return width < 768 ? "cards" : "table";
}

export function buildDataQualityExplanation(input: {
  score: number;
  checks: Array<{ key: string; label: string; status: "ok" | "warn" | "missing"; detail: string }>;
  missingActions?: string[];
}) {
  const missing = input.checks.filter((item) => item.status === "missing");
  const warnings = input.checks.filter((item) => item.status === "warn");
  const ok = input.checks.filter((item) => item.status === "ok");
  return {
    score: input.score,
    primaryAction: input.missingActions?.[0] ?? missing[0]?.label ?? null,
    missing,
    warnings,
    ok
  };
}

export function isSnapshotFresh(generatedAt: string | null | undefined, now = new Date().toISOString(), maxAgeMinutes = 30) {
  if (!generatedAt) {
    return false;
  }
  const generated = new Date(generatedAt);
  const current = new Date(now);
  if (Number.isNaN(generated.getTime()) || Number.isNaN(current.getTime())) {
    return false;
  }
  return current.getTime() - generated.getTime() <= maxAgeMinutes * 60 * 1000;
}

export type FundTradeWindowState = "before_cutoff" | "after_cutoff" | "closed";
export type FundDataFreshness = "fresh" | "stale" | "unknown";

function shanghaiParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: map.weekday
  };
}

function shanghaiDateKey(value: string | Date) {
  const parts = shanghaiParts(value);
  if (!parts) {
    return null;
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function daysBetweenDateKeys(startKey: string | null, endKey: string | null) {
  if (!startKey || !endKey) {
    return null;
  }
  const start = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function getFundTradeWindow(now = new Date().toISOString(), latestNavDate?: string | Date | null) {
  const parts = shanghaiParts(now);
  const nowKey = shanghaiDateKey(now);
  const navKey = latestNavDate ? shanghaiDateKey(latestNavDate) : null;
  const staleDays = daysBetweenDateKeys(navKey, nowKey);
  const dataFreshness: FundDataFreshness = staleDays === null ? "unknown" : staleDays <= 2 ? "fresh" : "stale";
  if (!parts) {
    return {
      state: "closed" as FundTradeWindowState,
      label: "交易时间未知",
      detail: "无法识别当前时间，先不要把页面结论当作当日交易依据。",
      dataFreshness,
      staleDays
    };
  }

  const minutes = parts.hour * 60 + parts.minute;
  const cutoff = 15 * 60;
  const state: FundTradeWindowState = !nowKey || !isChinaMarketTradingDay(nowKey) ? "closed" : minutes < cutoff ? "before_cutoff" : "after_cutoff";
  const label =
    state === "before_cutoff" ? "15:00 前可按今日申请" : state === "after_cutoff" ? "15:00 后顺延下一交易日" : "非交易日";
  const dataHint =
    dataFreshness === "stale"
      ? `最新净值距今天约 ${staleDays} 天，不能直接当作今日交易判断。`
      : dataFreshness === "unknown"
        ? "缺少最新净值日期，先补数据再判断。"
        : "净值日期处于正常披露节奏。";
  const detail =
    state === "before_cutoff"
      ? `当前仍在 15:00 前，开放式基金通常按今日申请、晚间确认净值。${dataHint}`
      : state === "after_cutoff"
        ? `当前已过 15:00，提交后通常按下一交易日申请处理。${dataHint}`
        : `当前不是常规交易日，适合复盘和准备条件，不适合按当日净值做交易判断。${dataHint}`;

  return { state, label, detail, dataFreshness, staleDays };
}

export type PositionSizingStatus = "within_limit" | "trim_order" | "over_limit" | "no_portfolio";

export function buildPositionSizing(input: {
  currentPortfolioValue: number | null | undefined;
  currentHoldingValue: number | null | undefined;
  plannedAmount: number | null | undefined;
  maxPositionWeight: number | null | undefined;
}) {
  const portfolioValue = Math.max(0, Number(input.currentPortfolioValue ?? 0));
  const holdingValue = Math.max(0, Number(input.currentHoldingValue ?? 0));
  const plannedAmount = Math.max(0, Number(input.plannedAmount ?? 0));
  const maxPositionWeight = Math.max(0, Number(input.maxPositionWeight ?? 0));
  if (portfolioValue <= 0 || maxPositionWeight <= 0) {
    return {
      currentWeight: portfolioValue > 0 ? (holdingValue / portfolioValue) * 100 : 0,
      afterPlannedWeight: plannedAmount > 0 ? 100 : 0,
      remainingCapacity: plannedAmount,
      suggestedAmount: plannedAmount,
      status: "no_portfolio" as PositionSizingStatus,
      message: "组合市值不足，先录入持仓后再判断仓位上限。"
    };
  }

  const maxWeight = Math.min(maxPositionWeight / 100, 0.99);
  const currentWeight = (holdingValue / portfolioValue) * 100;
  const afterPlannedWeight = ((holdingValue + plannedAmount) / (portfolioValue + plannedAmount)) * 100;
  const rawCapacity = (maxWeight * portfolioValue - holdingValue) / (1 - maxWeight);
  const remainingCapacity = Math.max(0, rawCapacity);
  const suggestedAmount = Math.min(plannedAmount, remainingCapacity);
  const status: PositionSizingStatus =
    currentWeight >= maxPositionWeight ? "over_limit" : suggestedAmount < plannedAmount ? "trim_order" : "within_limit";
  const message =
    status === "over_limit"
      ? "当前仓位已超过上限，不建议继续买入。"
      : status === "trim_order"
        ? "计划金额会让单仓超限，建议压缩本次买入金额。"
        : "计划金额不会突破当前单仓上限。";

  return {
    currentWeight,
    afterPlannedWeight,
    remainingCapacity,
    suggestedAmount,
    status,
    message
  };
}

export type FundTradeIntent = "buy" | "hold" | "wait" | "sell_review" | "data";

export function buildFundTradeAction(input: {
  held: boolean;
  dataScore: number;
  purchaseOpen: boolean;
  profitRate?: number | null;
  peerPercentile?: number | null;
  maxDrawdown?: number | null;
  maxDrawdownTolerance?: number | null;
  highImpactAnnouncementCount?: number | null;
  positionStatus?: PositionSizingStatus;
  tradeWindowState?: FundTradeWindowState;
}) {
  const reasons: string[] = [];
  if (input.dataScore < 55) {
    return {
      intent: "data" as FundTradeIntent,
      action: "先补数据",
      priority: "high" as const,
      reasons: ["数据可信度不足，先补净值、资料、费率或持仓。"]
    };
  }

  const drawdownTolerance = Number(input.maxDrawdownTolerance ?? 15);
  const drawdown = input.maxDrawdown ?? null;
  const peer = input.peerPercentile ?? null;
  const highImpactCount = Number(input.highImpactAnnouncementCount ?? 0);
  if (input.held) {
    if ((input.profitRate ?? 0) <= -10 || (drawdown !== null && Math.abs(drawdown) > drawdownTolerance) || peer !== null && peer < 35 || highImpactCount > 0) {
      if ((input.profitRate ?? 0) <= -10 || drawdown !== null && Math.abs(drawdown) > drawdownTolerance) reasons.push("亏损或回撤已触发承受上限。");
      if (peer !== null && peer < 35) reasons.push("同类表现跌到后 35% 区间。");
      if (highImpactCount > 0) reasons.push("存在高影响公告，需要复盘持有理由。");
      return {
        intent: "sell_review" as FundTradeIntent,
        action: highImpactCount > 0 || peer !== null && peer < 35 ? "减仓/卖出复盘" : "止损复盘",
        priority: "high" as const,
        reasons
      };
    }
    if (input.positionStatus === "over_limit") {
      return {
        intent: "sell_review" as FundTradeIntent,
        action: "仓位过高复盘",
        priority: "medium" as const,
        reasons: ["单只基金仓位已超过上限，优先考虑减仓或停止加仓。"]
      };
    }
    return {
      intent: "hold" as FundTradeIntent,
      action: "继续持有",
      priority: "low" as const,
      reasons: ["暂未触发止盈、止损、公告或排名恶化条件。"]
    };
  }

  if (!input.purchaseOpen) {
    return {
      intent: "wait" as FundTradeIntent,
      action: "暂不买入",
      priority: "medium" as const,
      reasons: ["当前申购状态不可确认，先核对销售平台。"]
    };
  }
  if (input.positionStatus === "over_limit" || input.positionStatus === "trim_order") {
    return {
      intent: input.positionStatus === "trim_order" ? "buy" as FundTradeIntent : "wait" as FundTradeIntent,
      action: input.positionStatus === "trim_order" ? "小额买入" : "暂不买入",
      priority: "medium" as const,
      reasons: ["计划金额会推高单仓占比，需要先控制仓位。"]
    };
  }
  if (peer !== null && peer >= 75 && (drawdown === null || Math.abs(drawdown) <= 12)) {
    return {
      intent: "buy" as FundTradeIntent,
      action: input.tradeWindowState === "after_cutoff" ? "准备下一交易日分批买入" : "可分批买入",
      priority: "high" as const,
      reasons: ["数据较完整、同类表现靠前，样本回撤未明显失控。"]
    };
  }
  return {
    intent: "wait" as FundTradeIntent,
    action: "继续观察",
    priority: "low" as const,
    reasons: ["尚未形成足够强的买入信号。"]
  };
}

export type SellReviewSignal = {
  key: "take_profit" | "stop_loss" | "peer_deterioration" | "announcement" | "short_holding_fee";
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
};

export function buildSellReviewSignals(input: {
  profitRate?: number | null;
  targetReturn?: number | null;
  maxDrawdown?: number | null;
  maxDrawdownTolerance?: number | null;
  peerPercentile?: number | null;
  holdingDays?: number | null;
  highImpactAnnouncementCount?: number | null;
  redemptionRate?: number | null;
}) {
  const signals: SellReviewSignal[] = [];
  const profitRate = input.profitRate ?? null;
  const targetReturn = Number(input.targetReturn ?? 18);
  const maxDrawdown = input.maxDrawdown ?? null;
  const maxDrawdownTolerance = Number(input.maxDrawdownTolerance ?? 15);
  const peerPercentile = input.peerPercentile ?? null;
  const holdingDays = input.holdingDays ?? null;
  const highImpactAnnouncementCount = Number(input.highImpactAnnouncementCount ?? 0);

  if (profitRate !== null && profitRate >= targetReturn) {
    signals.push({
      key: "take_profit",
      level: "medium",
      title: "止盈复盘",
      detail: `累计收益约 ${profitRate.toFixed(2)}%，已达到 ${targetReturn.toFixed(2)}% 目标。`
    });
  }
  if (maxDrawdown !== null && Math.abs(maxDrawdown) > maxDrawdownTolerance) {
    signals.push({
      key: "stop_loss",
      level: "high",
      title: "止损复盘",
      detail: `样本最大回撤约 ${maxDrawdown.toFixed(2)}%，超过 ${maxDrawdownTolerance.toFixed(2)}% 承受上限。`
    });
  }
  if (peerPercentile !== null && peerPercentile < 40) {
    signals.push({
      key: "peer_deterioration",
      level: "medium",
      title: "同类排名恶化",
      detail: `同类百分位约 ${peerPercentile.toFixed(1)}%，需要确认是否仍有持有理由。`
    });
  }
  if (highImpactAnnouncementCount > 0) {
    signals.push({
      key: "announcement",
      level: "high",
      title: "高影响公告",
      detail: `有 ${highImpactAnnouncementCount} 条高影响公告，先看经理、费率、限购或清盘风险。`
    });
  }
  if (holdingDays !== null && holdingDays < 7 && isKnownRate(input.redemptionRate)) {
    signals.push({
      key: "short_holding_fee",
      level: "medium",
      title: "短期赎回费",
      detail: `持有约 ${holdingDays} 天，赎回费率约 ${Number(input.redemptionRate).toFixed(2)}%。`
    });
  }

  const hasHigh = signals.some((item) => item.level === "high");
  return {
    signals,
    conclusion: signals.length === 0 ? "继续持有观察" : hasHigh ? "卖出/减仓复盘" : "持有/止盈复盘"
  };
}

export function buildTradingCostScenarios(input: {
  feeSummary: FeeSummaryLike | null | undefined;
  amount: number;
  days?: number[];
}) {
  const days = input.days ?? [7, 30, 180, 365];
  return days.map((day) => {
    const baseCost = estimateKnownFeeCost(input.feeSummary, day, input.amount);
    const redemptionCost = hasKnownFeeRate(input.feeSummary) ? input.amount * ((input.feeSummary?.redemptionRate ?? 0) / 100) : null;
    const cost = baseCost === null || redemptionCost === null ? null : baseCost + redemptionCost;
    return {
      days: day,
      label: day >= 365 ? "持有 1 年" : `持有 ${day} 天`,
      cost,
      warning: day <= 7 && (input.feeSummary?.redemptionRate ?? 0) > 0 ? "短期赎回成本高" : null
    };
  });
}

export type DailyTradingDeskItem = {
  kind: "data" | "buy" | "review" | "wait";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  href: string;
};

export function buildDailyTradingDesk(input: {
  tradeWindow: Pick<ReturnType<typeof getFundTradeWindow>, "state" | "dataFreshness">;
  reviewItems?: Array<{ title: string; href: string; detail?: string }>;
  buyItems?: Array<{ title: string; href: string; detail?: string }>;
  waitItems?: Array<{ title: string; href: string; detail?: string }>;
}) {
  const items: DailyTradingDeskItem[] = [];
  if (input.tradeWindow.dataFreshness === "stale") {
    items.push({
      kind: "data",
      priority: "high",
      title: "先确认数据更新",
      detail: "基金净值披露滞后，今天的交易判断先降级为复盘和准备。",
      href: "/sync"
    });
  }
  for (const item of input.buyItems ?? []) {
    items.push({
      kind: "buy",
      priority: input.tradeWindow.state === "before_cutoff" ? "high" : "medium",
      title: item.title,
      detail: item.detail ?? "进入详情页确认买入金额、交易窗口和组合影响。",
      href: item.href
    });
  }
  for (const item of input.reviewItems ?? []) {
    items.push({
      kind: "review",
      priority: "medium",
      title: item.title,
      detail: item.detail ?? "持仓触发复盘条件，先看卖出/减仓信号。",
      href: item.href
    });
  }
  for (const item of input.waitItems ?? []) {
    items.push({
      kind: "wait",
      priority: "low",
      title: item.title,
      detail: item.detail ?? "当前条件不足，不需要当天交易。",
      href: item.href
    });
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  const kindRank = { data: 0, buy: 1, review: 2, wait: 3 };
  return {
    items: items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || kindRank[a.kind] - kindRank[b.kind]).slice(0, 8)
  };
}

function isPresent(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function buildTradeConfirmationChecklist(input: {
  applicationAmount?: number | null;
  applicationDate?: string | null;
  confirmationDate?: string | null;
  confirmedNav?: number | null;
  confirmedShares?: number | null;
  fee?: number | null;
}) {
  const checks = [
    { label: "申请日期", ok: isPresent(input.applicationDate) },
    { label: "申请金额", ok: Number(input.applicationAmount ?? 0) > 0 },
    { label: "确认日期", ok: isPresent(input.confirmationDate) },
    { label: "确认净值", ok: Number(input.confirmedNav ?? 0) > 0 },
    { label: "确认份额", ok: Number(input.confirmedShares ?? 0) > 0 },
    { label: "手续费", ok: input.fee !== null && input.fee !== undefined && Number(input.fee) >= 0 }
  ];
  const missing = checks.filter((item) => !item.ok).map((item) => item.label);
  return {
    status: missing.length ? "pending_confirmation" as const : "confirmed" as const,
    missing,
    checks,
    summary: missing.length ? `待补 ${missing.join("、")}` : "成交确认信息完整"
  };
}

const CHINA_MARKET_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"
]);

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromDate(date);
}

export function isChinaMarketTradingDay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  if (dateKey.startsWith("2026-") && CHINA_MARKET_HOLIDAYS_2026.has(dateKey)) {
    return false;
  }
  return true;
}

export function nextChinaMarketTradingDay(dateKey: string, offset = 1) {
  let cursor = dateKey;
  let remaining = Math.max(1, Math.floor(offset));
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isChinaMarketTradingDay(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

function nextOrSameChinaMarketTradingDay(dateKey: string) {
  let cursor = dateKey;
  while (!isChinaMarketTradingDay(cursor)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function parsePercentText(value: string | null | undefined) {
  const match = String(value ?? "").match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function matchHoldingDays(condition: string, holdingDays: number) {
  const text = condition.replace(/\s/g, "");
  const numbers = [...text.matchAll(/[0-9]+/g)].map((item) => Number(item[0]));
  if (/小于|少于|以内|不满|<|＜/.test(text) && numbers.length >= 1) {
    return holdingDays < numbers[0];
  }
  if (/大于等于|不少于|>=|≥/.test(text) && /小于|<|＜/.test(text) && numbers.length >= 2) {
    return holdingDays >= numbers[0] && holdingDays < numbers[1];
  }
  if (/大于等于|不少于|以上|>=|≥/.test(text) && numbers.length >= 1) {
    return holdingDays >= numbers[0];
  }
  return false;
}

export function buildRedemptionPlan(input: {
  amount: number;
  holdingDays: number | null | undefined;
  requestDate: string;
  feeRows?: Array<{ conditionName?: string | null; feeValue?: string | null }>;
  redemptionRate?: number | null;
  settlementTradingDays?: number;
}) {
  const amount = Math.max(0, Number(input.amount ?? 0));
  const holdingDays = Math.max(0, Number(input.holdingDays ?? 0));
  const ladder = (input.feeRows ?? [])
    .map((row) => ({
      condition: row.conditionName || "默认赎回费",
      rate: parsePercentText(row.feeValue)
    }))
    .filter((row): row is { condition: string; rate: number } => row.rate !== null);
  const matched = ladder.find((row) => matchHoldingDays(row.condition, holdingDays));
  const currentRate = matched?.rate ?? input.redemptionRate ?? (ladder[0]?.rate ?? null);
  const currentFee = currentRate === null ? null : amount * (currentRate / 100);
  const estimatedArrivalDate = nextChinaMarketTradingDay(input.requestDate, input.settlementTradingDays ?? 1);
  return {
    ladder,
    currentRate,
    currentFee,
    estimatedArrivalDate,
    summary: currentRate === null ? "赎回费率待确认" : `按当前持有天数估算赎回费约 ¥${currentFee?.toFixed(2)}，预计 ${estimatedArrivalDate} 到账。`
  };
}

export function buildAutoReviewPlan(input: {
  baseDate: string;
  targetReturn: number;
  maxDrawdownTolerance: number;
  peerFloor?: number;
}) {
  const peerFloor = input.peerFloor ?? 40;
  return {
    items: [
      { key: "confirm", date: nextChinaMarketTradingDay(input.baseDate, 1), title: "成交确认", detail: "核对确认净值、确认份额和手续费。" },
      { key: "week_review", date: nextOrSameChinaMarketTradingDay(addDays(input.baseDate, 7)), title: "7 天复盘", detail: "看短期波动和是否触发短期赎回费。" },
      { key: "month_review", date: nextOrSameChinaMarketTradingDay(addDays(input.baseDate, 30)), title: "30 天复盘", detail: "核对同类排名、回撤和买入理由是否仍成立。" },
      { key: "drawdown_trigger", date: null, title: "回撤触发", detail: `从买入后回撤超过 ${input.maxDrawdownTolerance}% 时进入复盘。` },
      { key: "peer_trigger", date: null, title: "同类触发", detail: `同类百分位跌破 ${peerFloor}% 时进入复盘。` },
      { key: "target_return", date: null, title: "止盈触发", detail: `累计收益达到 ${input.targetReturn}% 时复盘是否分批止盈。` }
    ]
  };
}

export function chooseAlternativeFunds<T extends {
  code: string;
  name: string;
  fundType: string | null;
  observationScore: number;
  maxDrawdown: number | null;
  year1Return?: number | null;
}>(input: {
  currentCode: string;
  fundType: string | null;
  candidates: T[];
  maxAlternatives?: number;
}) {
  return input.candidates
    .filter((item) => item.code !== input.currentCode && (!input.fundType || item.fundType === input.fundType))
    .sort((a, b) => {
      const drawdownDiff = (b.maxDrawdown ?? -999) - (a.maxDrawdown ?? -999);
      if (drawdownDiff !== 0) return drawdownDiff;
      return b.observationScore - a.observationScore;
    })
    .slice(0, input.maxAlternatives ?? 5);
}

function formatCurrency(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildMoneyRiskFrame(input: {
  plannedAmount?: number | null;
  currentValue?: number | null;
  profit?: number | null;
  maxDrawdown?: number | null;
  dailyRate?: number | null;
}) {
  const plannedAmount = Number(input.plannedAmount ?? 0);
  const currentValue = Number(input.currentValue ?? 0);
  const profit = Number(input.profit ?? 0);
  const maxDrawdown = input.maxDrawdown ?? null;
  const dailyRate = input.dailyRate ?? null;
  const plannedDrawdownLoss = maxDrawdown === null ? null : Math.round(plannedAmount * Math.abs(maxDrawdown) / 100);
  const dailyMoveAmount = dailyRate === null ? null : Math.round(currentValue * dailyRate / 100);
  return {
    plannedDrawdownLoss,
    dailyMoveAmount,
    currentProfitText: profit >= 0 ? `当前盈利约 ${formatCurrency(profit)}` : `当前亏损约 ${formatCurrency(Math.abs(profit))}`,
    plannedRiskText: plannedDrawdownLoss === null ? "样本回撤不足，无法估算金额风险" : `买 ${formatCurrency(plannedAmount)}，样本最大回撤约亏 ${formatCurrency(plannedDrawdownLoss)}`,
    dailyMoveText: dailyMoveAmount === null ? "缺少日涨跌，无法估算今日金额影响" : `今日估算影响 ${dailyMoveAmount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(dailyMoveAmount))}`
  };
}

export function evaluateUserAlertRule(
  rule: { metric: string; threshold?: number | null },
  context: {
    dailyRate?: number | null;
    profitRate?: number | null;
    peerPercentile?: number | null;
    positionWeight?: number | null;
    highImpactAnnouncementCount?: number | null;
  }
) {
  const threshold = Number(rule.threshold ?? 0);
  if (rule.metric === "daily_drop" && context.dailyRate !== null && context.dailyRate !== undefined && context.dailyRate <= -Math.abs(threshold)) {
    return { level: "high" as const, title: "单日跌幅触发", message: `日涨跌 ${context.dailyRate.toFixed(2)}%，超过 ${Math.abs(threshold)}% 下跌阈值。` };
  }
  if (rule.metric === "take_profit" && context.profitRate !== null && context.profitRate !== undefined && context.profitRate >= threshold) {
    return { level: "medium" as const, title: "止盈触发", message: `收益率 ${context.profitRate.toFixed(2)}%，达到 ${threshold}% 目标。` };
  }
  if (rule.metric === "peer_below" && context.peerPercentile !== null && context.peerPercentile !== undefined && context.peerPercentile < threshold) {
    return { level: "medium" as const, title: "同类排名触发", message: `同类百分位 ${context.peerPercentile.toFixed(1)}%，低于 ${threshold}%。` };
  }
  if (rule.metric === "position_over" && context.positionWeight !== null && context.positionWeight !== undefined && context.positionWeight > threshold) {
    return { level: "high" as const, title: "仓位超限", message: `当前仓位 ${context.positionWeight.toFixed(1)}%，超过 ${threshold}% 上限。` };
  }
  if (rule.metric === "manager_change" && Number(context.highImpactAnnouncementCount ?? 0) > 0) {
    return { level: "high" as const, title: "公告/经理变更触发", message: "存在高影响公告，建议复盘持有理由。" };
  }
  return null;
}

export function buildMobileTradeCard(input: {
  action: string;
  suggestedAmount: number | null;
  tradeWindowLabel: string;
  riskText: string;
  primaryHref: string;
}) {
  return {
    primaryAction: "查看交易参考",
    primaryHref: input.primaryHref,
    items: [
      { label: "结论", value: input.action },
      { label: "金额", value: input.suggestedAmount === null ? "待确认" : formatCurrency(input.suggestedAmount) },
      { label: "窗口", value: input.tradeWindowLabel },
      { label: "风险", value: input.riskText }
    ]
  };
}

function dateOnlyKey(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function signatureNumber(value: number | null | undefined, digits: number) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }
  return Number(value).toFixed(digits);
}

export function buildTransactionSignature(input: {
  targetType: string;
  targetKey: string;
  transactionType: string;
  tradeDate: string | Date;
  shares?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
}) {
  return [
    String(input.targetType).trim().toLowerCase(),
    String(input.targetKey).trim(),
    String(input.transactionType).trim().toLowerCase(),
    dateOnlyKey(input.tradeDate),
    signatureNumber(input.shares, 6),
    signatureNumber(input.price, 6),
    signatureNumber(input.amount, 2),
    signatureNumber(input.fee, 2)
  ].join("|");
}

export function buildHoldingReconciliation(input: {
  manualShares?: number | null;
  manualCostAmount?: number | null;
  transactions: Array<{
    transactionType: string;
    shares?: number | null;
    amount?: number | null;
    fee?: number | null;
  }>;
}) {
  let derivedShares = 0;
  let derivedCostAmount = 0;
  for (const transaction of input.transactions) {
    const shares = Number(transaction.shares ?? 0);
    const amount = Number(transaction.amount ?? 0);
    const fee = Number(transaction.fee ?? 0);
    if (transaction.transactionType === "buy") {
      derivedShares += shares;
      derivedCostAmount += amount + fee;
    } else if (transaction.transactionType === "sell") {
      derivedShares -= shares;
      derivedCostAmount -= amount + fee;
    } else if (transaction.transactionType === "fee") {
      derivedCostAmount += fee || amount;
    }
  }
  const manualShares = input.manualShares ?? null;
  const manualCostAmount = input.manualCostAmount ?? null;
  const shareDifference = manualShares === null ? null : Number((manualShares - derivedShares).toFixed(6));
  const costDifference = manualCostAmount === null ? null : Number((manualCostAmount - derivedCostAmount).toFixed(2));
  const hasTransactions = input.transactions.length > 0;
  const shareMismatch = shareDifference !== null && Math.abs(shareDifference) > 0.0001;
  const costMismatch = costDifference !== null && Math.abs(costDifference) > 1;
  return {
    derivedShares: Number(derivedShares.toFixed(6)),
    derivedCostAmount: Number(derivedCostAmount.toFixed(2)),
    shareDifference,
    costDifference,
    status: !hasTransactions ? "manual_only" as const : shareMismatch || costMismatch ? "warn" as const : "ok" as const
  };
}

export function normalizeAlertActionState(value: unknown): AlertActionState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const action = (value as { action?: unknown }).action;
  if (action === "done" || action === "reject") {
    return { action };
  }
  if (action === "snooze") {
    const until = (value as { until?: unknown }).until;
    if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return null;
    }
    return { action: "snooze", until };
  }
  return null;
}

function bestMetric<T extends { key: string; name: string }>(
  items: T[],
  getValue: (item: T) => number | null | undefined,
  direction: "higher" | "lowerAbs" | "lower"
) {
  const usable = items
    .map((item) => ({ item, value: getValue(item) }))
    .filter((row): row is { item: T; value: number } => row.value !== null && row.value !== undefined && Number.isFinite(row.value));
  if (!usable.length) {
    return null;
  }
  const score = (value: number) => direction === "lowerAbs" ? Math.abs(value) : value;
  const target =
    direction === "higher"
      ? Math.max(...usable.map((row) => score(row.value)))
      : Math.min(...usable.map((row) => score(row.value)));
  return usable.find((row) => score(row.value) === target)?.item ?? null;
}

export function summarizeComparisonInsights(items: Array<{
  key: string;
  name: string;
  metrics: {
    return1y?: number | null;
    maxDrawdown?: number | null;
    feeKnown?: boolean | null;
    feeCost365d?: number | null;
    dataScore?: number | null;
  };
}>) {
  const returnWinner = bestMetric(items, (item) => item.metrics.return1y, "higher");
  const riskWinner = bestMetric(items, (item) => item.metrics.maxDrawdown, "lowerAbs");
  const feeWinner = bestMetric(items.filter((item) => item.metrics.feeKnown), (item) => item.metrics.feeCost365d, "lower");
  const dataWinner = bestMetric(items, (item) => item.metrics.dataScore, "higher");
  const incomplete = items.filter((item) =>
    item.metrics.return1y === null ||
    item.metrics.return1y === undefined ||
    item.metrics.maxDrawdown === null ||
    item.metrics.maxDrawdown === undefined ||
    !item.metrics.feeKnown ||
    Number(item.metrics.dataScore ?? 0) < 55
  );
  return [
    {
      key: "return",
      label: "收益",
      winnerKey: returnWinner?.key ?? null,
      winnerName: returnWinner?.name ?? null,
      detail: returnWinner ? `${returnWinner.name} 的近一年收益相对更高。` : "收益数据不足，暂不判断。"
    },
    {
      key: "risk",
      label: "风险",
      winnerKey: riskWinner?.key ?? null,
      winnerName: riskWinner?.name ?? null,
      detail: riskWinner ? `${riskWinner.name} 的样本回撤相对更低。` : "回撤数据不足，暂不判断。"
    },
    {
      key: "fee",
      label: "费率",
      winnerKey: feeWinner?.key ?? null,
      winnerName: feeWinner?.name ?? null,
      detail: feeWinner ? `${feeWinner.name} 的一年持有成本估算更低。` : "费率解析不足，暂不判断。"
    },
    {
      key: "data",
      label: "资料",
      winnerKey: dataWinner?.key ?? null,
      winnerName: dataWinner?.name ?? null,
      detail: incomplete.length
        ? `${incomplete.map((item) => item.name).join("、")} 存在收益、回撤、费率或资料缺口。`
        : dataWinner
          ? `${dataWinner.name} 的资料完整度相对更高。`
          : "资料完整度不足，暂不判断。"
    }
  ];
}

export function buildSyncJobState(input: {
  status: string;
  startedAt: string | Date | null | undefined;
  now?: string | Date;
  stuckAfterHours?: number;
}) {
  const started = input.startedAt ? new Date(input.startedAt) : null;
  const current = new Date(input.now ?? new Date());
  const ageHours =
    started && !Number.isNaN(started.getTime()) && !Number.isNaN(current.getTime())
      ? Math.round(((current.getTime() - started.getTime()) / 3600000) * 10) / 10
      : null;
  const threshold = input.stuckAfterHours ?? 4;
  const state = input.status === "running" && ageHours !== null && ageHours >= threshold ? "stuck" : input.status;
  return { state, ageHours };
}

export function buildRebalancePlan(input: {
  totalValue: number;
  targets: Array<{
    key: string;
    label: string;
    currentWeight: number | null | undefined;
    targetWeight?: number | null;
    maxWeight?: number | null;
  }>;
  driftThresholdPercent?: number;
}) {
  const totalValue = Math.max(0, Number(input.totalValue ?? 0));
  const threshold = input.driftThresholdPercent ?? 5;
  const items = input.targets.map((target) => {
    const currentWeight = Number(target.currentWeight ?? 0);
    const targetWeight = target.targetWeight ?? null;
    const maxWeight = target.maxWeight ?? null;
    const drift = targetWeight === null ? null : currentWeight - targetWeight;
    const amount = drift === null ? 0 : Number((-(drift / 100) * totalValue).toFixed(2));
    const overLimit = maxWeight !== null && currentWeight > maxWeight;
    const action =
      overLimit ? "over_limit" as const :
      drift === null || Math.abs(drift) < threshold ? "hold" as const :
      drift > 0 ? "trim" as const : "add" as const;
    return {
      ...target,
      currentWeight,
      targetWeight,
      maxWeight,
      drift,
      amount,
      action,
      message:
        action === "over_limit" ? `${target.label} 超过上限，优先压降。` :
        action === "trim" ? `${target.label} 高于目标，建议减少约 ${formatCurrency(Math.abs(amount))}。` :
        action === "add" ? `${target.label} 低于目标，可补充约 ${formatCurrency(Math.abs(amount))}。` :
        `${target.label} 接近目标，暂不调整。`
    };
  });
  return {
    items,
    summary: {
      addCount: items.filter((item) => item.action === "add").length,
      trimCount: items.filter((item) => item.action === "trim").length,
      overLimitCount: items.filter((item) => item.action === "over_limit").length
    }
  };
}

export function buildCashLedgerSummary(transactions: Array<{ transactionType: string; amount: number | null | undefined }>) {
  let inflow = 0;
  let outflow = 0;
  for (const transaction of transactions) {
    const amount = Math.abs(Number(transaction.amount ?? 0));
    if (["deposit", "sell", "dividend", "interest", "transfer_in"].includes(transaction.transactionType)) {
      inflow += amount;
    } else if (["withdraw", "buy", "fee", "transfer_out"].includes(transaction.transactionType)) {
      outflow += amount;
    }
  }
  return {
    inflow: Number(inflow.toFixed(2)),
    outflow: Number(outflow.toFixed(2)),
    balance: Number((inflow - outflow).toFixed(2))
  };
}

export function evaluateAdvancedAlertRule(
  rule: { metric: string; threshold?: number | null },
  context: {
    recentDailyRates?: Array<number | null | undefined>;
    returnValue?: number | null;
    peerMedianReturn?: number | null;
    maxDrawdown?: number | null;
    previousMaxDrawdown?: number | null;
    positionWeight?: number | null;
  }
) {
  const threshold = Number(rule.threshold ?? 0);
  if (rule.metric === "consecutive_drop") {
    const required = Math.max(2, Math.floor(threshold || 3));
    const rates = context.recentDailyRates ?? [];
    const drops = rates.slice(0, required).filter((value) => Number(value ?? 0) < 0).length;
    if (drops >= required) {
      return { level: "high" as const, title: "连续下跌触发", message: `最近 ${required} 个净值日连续下跌。` };
    }
  }
  if (rule.metric === "peer_lag" && context.returnValue !== null && context.returnValue !== undefined && context.peerMedianReturn !== null && context.peerMedianReturn !== undefined) {
    const lag = context.peerMedianReturn - context.returnValue;
    if (lag >= Math.abs(threshold || 8)) {
      return { level: "medium" as const, title: "跑输同类触发", message: `阶段收益落后同类中位约 ${lag.toFixed(2)}%。` };
    }
  }
  if (rule.metric === "drawdown_new_high" && context.maxDrawdown !== null && context.maxDrawdown !== undefined) {
    const drawdown = Math.abs(context.maxDrawdown);
    const previous = Math.abs(context.previousMaxDrawdown ?? 0);
    if (drawdown >= Math.abs(threshold || 15) && drawdown > previous) {
      return { level: "high" as const, title: "回撤新高触发", message: `样本最大回撤扩大到约 ${drawdown.toFixed(2)}%。` };
    }
  }
  if (rule.metric === "position_over" && context.positionWeight !== null && context.positionWeight !== undefined && context.positionWeight > threshold) {
    return { level: "high" as const, title: "仓位超限", message: `当前仓位 ${context.positionWeight.toFixed(1)}%，超过 ${threshold}% 上限。` };
  }
  return null;
}

export function summarizeDataSourceHealth(jobs: Array<{
  jobType: string;
  status: string;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  failedSources?: string | null;
  message?: string | null;
}>) {
  const sourceMap = new Map<string, {
    source: string;
    successCount: number;
    failedCount: number;
    latestSuccessAt: string | null;
    latestFailureAt: string | null;
    lastError: string | null;
  }>();
  const ensure = (source: string) => {
    const key = source.trim() || "unknown";
    const current = sourceMap.get(key) ?? { source: key, successCount: 0, failedCount: 0, latestSuccessAt: null, latestFailureAt: null, lastError: null };
    sourceMap.set(key, current);
    return current;
  };
  for (const job of jobs) {
    const text = `${job.jobType} ${job.message ?? ""}`.toLowerCase();
    const sources = new Set<string>();
    for (const source of (job.failedSources ?? "").split(",")) {
      if (source.trim()) sources.add(source.trim());
    }
    for (const source of ["akshare", "chinawealth", "announcement", "profile", "history", "fund"]) {
      if (text.includes(source)) sources.add(source);
    }
    if (!sources.size) sources.add("general");
    for (const source of sources) {
      const row = ensure(source);
      const time = new Date(job.finishedAt ?? job.startedAt).toISOString();
      if (job.status === "success" && !(job.failedSources ?? "").includes(source)) {
        row.successCount += 1;
        row.latestSuccessAt = !row.latestSuccessAt || time > row.latestSuccessAt ? time : row.latestSuccessAt;
      } else if (job.status !== "running") {
        row.failedCount += 1;
        row.latestFailureAt = !row.latestFailureAt || time > row.latestFailureAt ? time : row.latestFailureAt;
        row.lastError = job.message ?? job.failedSources ?? null;
      }
    }
  }
  return [...sourceMap.values()]
    .map((row) => ({
      ...row,
      status: row.failedCount === 0 ? "good" as const : row.successCount === 0 ? "bad" as const : "warn" as const
    }))
    .sort((a, b) => b.failedCount - a.failedCount || a.source.localeCompare(b.source));
}

export function buildDashboardSnapshotState(generatedAt: string | Date | null | undefined, now = new Date().toISOString(), maxAgeMinutes = 30) {
  if (!generatedAt) {
    return { state: "missing" as const, ageMinutes: null };
  }
  const generated = new Date(generatedAt);
  const current = new Date(now);
  if (Number.isNaN(generated.getTime()) || Number.isNaN(current.getTime())) {
    return { state: "missing" as const, ageMinutes: null };
  }
  const ageMinutes = Math.round((current.getTime() - generated.getTime()) / 60000);
  return { state: ageMinutes <= maxAgeMinutes ? "fresh" as const : "stale" as const, ageMinutes };
}

export function buildDecisionReviewState(input: { reviewDate?: string | null; status?: string | null }, nowDate = new Date().toISOString().slice(0, 10)) {
  if (input.status === "closed") {
    return { state: "closed" as const };
  }
  if (!input.reviewDate) {
    return { state: "unscheduled" as const };
  }
  if (input.reviewDate < nowDate) {
    return { state: "overdue" as const };
  }
  if (input.reviewDate === nowDate) {
    return { state: "due" as const };
  }
  return { state: "scheduled" as const };
}
