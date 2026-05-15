import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertRuleForm } from "@/components/AlertRuleForm";
import { BackfillButton } from "@/components/BackfillButton";
import { AddCompareButton } from "@/components/CompareTray";
import { NavChart } from "@/components/NavChart";
import { PurchaseDecisionForm, type PurchaseDecisionSettings } from "@/components/PurchaseDecisionForm";
import { TrendBadge } from "@/components/TrendBadge";
import { WatchButton } from "@/components/WatchButton";
import { formatDate, formatNumber } from "@/lib/format";
import {
  buildAutoReviewPlan,
  buildDataQualityExplanation,
  buildFundTradeAction,
  buildMobileTradeCard,
  buildMoneyRiskFrame,
  buildPositionSizing,
  buildRedemptionPlan,
  buildSellReviewSignals,
  buildTradingCostScenarios,
  estimateKnownFeeCost,
  formatSampleScope,
  getDecisionQueueMissingFields,
  getFundTradeWindow
} from "@/lib/fund-ux";
import { getAlertRulesForTarget, getFundAlternatives, getFundDetail, getPortfolioDashboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
};

type FundDetail = NonNullable<Awaited<ReturnType<typeof getFundDetail>>>;
type PortfolioDashboard = Awaited<ReturnType<typeof getPortfolioDashboard>>;
type DecisionStatus = "ok" | "warn" | "missing";

const PLANNED_BUY_AMOUNT = 10000;
const DEFAULT_DECISION_SETTINGS: PurchaseDecisionSettings = {
  riskProfile: "balanced",
  plannedAmount: PLANNED_BUY_AMOUNT,
  maxDrawdownTolerance: 15,
  targetReturn: 8,
  observationStatus: "researching",
  buyCondition: "",
  rejectCondition: "",
  reviewDate: "",
  reviewNote: ""
};

function isOpenForPurchase(status: string | null | undefined) {
  if (!status) {
    return false;
  }
  const normalized = status.replace(/\s/g, "");
  return (
    (normalized.includes("开放") || normalized.includes("申购")) &&
    !/(暂停|封闭|停止|不可|限制)/.test(normalized)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dateKey(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function chinaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function latestIndustryRows(fund: FundDetail) {
  const latestDate = dateKey(fund.industries[0]?.reportDate);
  return fund.industries
    .filter((item) => dateKey(item.reportDate) === latestDate)
    .slice(0, 6);
}

function latestStockRows(fund: FundDetail) {
  const latestPeriod = fund.holdings[0]?.reportPeriod;
  return fund.holdings
    .filter((item) => item.reportPeriod === latestPeriod)
    .slice(0, 6);
}

function estimateCost(
  feeSummary: FundDetail["shareClassComparison"]["items"][number]["feeSummary"] | undefined,
  days: number,
  amount = PLANNED_BUY_AMOUNT
) {
  return estimateKnownFeeCost(feeSummary, days, amount);
}

function fitStatus(condition: boolean, fallback: boolean): DecisionStatus {
  if (condition) {
    return "ok";
  }
  return fallback ? "warn" : "missing";
}

function parseDecisionSettings(note: string | null | undefined): PurchaseDecisionSettings {
  if (!note) {
    return DEFAULT_DECISION_SETTINGS;
  }
  try {
    const payload = JSON.parse(note) as Partial<PurchaseDecisionSettings>;
    return {
      riskProfile:
        payload.riskProfile === "conservative" || payload.riskProfile === "balanced" || payload.riskProfile === "aggressive"
          ? payload.riskProfile
          : DEFAULT_DECISION_SETTINGS.riskProfile,
      plannedAmount:
        Number.isFinite(Number(payload.plannedAmount)) && Number(payload.plannedAmount) > 0
          ? Number(payload.plannedAmount)
          : DEFAULT_DECISION_SETTINGS.plannedAmount,
      maxDrawdownTolerance:
        Number.isFinite(Number(payload.maxDrawdownTolerance)) && Number(payload.maxDrawdownTolerance) > 0
          ? Number(payload.maxDrawdownTolerance)
          : DEFAULT_DECISION_SETTINGS.maxDrawdownTolerance,
      targetReturn:
        Number.isFinite(Number(payload.targetReturn))
          ? Number(payload.targetReturn)
          : DEFAULT_DECISION_SETTINGS.targetReturn,
      observationStatus:
        payload.observationStatus === "waiting_pullback" ||
        payload.observationStatus === "ready_to_buy" ||
        payload.observationStatus === "bought" ||
        payload.observationStatus === "rejected"
          ? payload.observationStatus
          : DEFAULT_DECISION_SETTINGS.observationStatus,
      buyCondition: typeof payload.buyCondition === "string" ? payload.buyCondition : DEFAULT_DECISION_SETTINGS.buyCondition,
      rejectCondition: typeof payload.rejectCondition === "string" ? payload.rejectCondition : DEFAULT_DECISION_SETTINGS.rejectCondition,
      reviewDate: typeof payload.reviewDate === "string" ? payload.reviewDate : DEFAULT_DECISION_SETTINGS.reviewDate,
      reviewNote: typeof payload.reviewNote === "string" ? payload.reviewNote : DEFAULT_DECISION_SETTINGS.reviewNote
    };
  } catch {
    return {
      ...DEFAULT_DECISION_SETTINGS,
      reviewNote: note
    };
  }
}

function riskProfileLabel(value: PurchaseDecisionSettings["riskProfile"]) {
  if (value === "conservative") {
    return "稳健型";
  }
  if (value === "aggressive") {
    return "进取型";
  }
  return "均衡型";
}

function statusLabel(value: PurchaseDecisionSettings["observationStatus"]) {
  const labels = {
    researching: "待研究",
    waiting_pullback: "等待回调",
    ready_to_buy: "准备买入",
    bought: "已买入",
    rejected: "放弃"
  };
  return labels[value];
}

function buildPurchaseDecision(
  fund: FundDetail,
  portfolio: PortfolioDashboard,
  purchaseOpen: boolean,
  dataScore: number,
  settings: PurchaseDecisionSettings
) {
  const latest = fund.navs.at(-1);
  const oneYearReturn = fund.periodReturns.find((item) => item.rangeKey === "year_1");
  const threeMonthReturn = fund.periodReturns.find((item) => item.rangeKey === "month_3");
  const sixMonthReturn = fund.periodReturns.find((item) => item.rangeKey === "month_6");
  const maxDrawdown = fund.riskMetrics.maxDrawdown;
  const volatility = fund.riskMetrics.volatility;
  const currentShareClass = fund.shareClassComparison.items.find((item) => item.isCurrent);
  const topIndustries = latestIndustryRows(fund);
  const topStocks = latestStockRows(fund);
  const portfolioItem = portfolio.items.find((item) => item.targetType === "fund" && item.targetKey === fund.code);
  const currentPortfolioValue = portfolio.summary.currentValue ?? 0;
  const currentHoldingValue = portfolioItem?.currentValue ?? 0;
  const plannedAmount = settings.plannedAmount > 0 ? settings.plannedAmount : PLANNED_BUY_AMOUNT;
  const currentWeight = currentPortfolioValue > 0 ? (currentHoldingValue / currentPortfolioValue) * 100 : 0;
  const afterWeight =
    currentPortfolioValue + plannedAmount > 0
      ? ((currentHoldingValue + plannedAmount) / (currentPortfolioValue + plannedAmount)) * 100
      : 100;
  const portfolioIndustryNames = new Set(portfolio.concentration.topIndustries.map((item) => item.industryName));
  const overlappingIndustries = topIndustries.filter((item) => portfolioIndustryNames.has(item.industryName));
  const navValues = fund.navs
    .map((item) => item.unitNav)
    .filter((value): value is number => value !== null && value !== undefined && value > 0);
  const minNav = navValues.length ? Math.min(...navValues) : null;
  const maxNav = navValues.length ? Math.max(...navValues) : null;
  const navPosition =
    latest?.unitNav && minNav !== null && maxNav !== null && maxNav > minNav
      ? ((latest.unitNav - minNav) / (maxNav - minNav)) * 100
      : null;
  const timingStatus =
    navPosition === null
      ? "样本不足"
      : navPosition >= 85 && (threeMonthReturn?.rankValue ?? 0) > 8
        ? "偏热"
        : navPosition <= 35
          ? "回落区"
          : "中性区";
  const timingDetail =
    navPosition === null
      ? "净值样本不足，不能判断相对高低"
      : timingStatus === "偏热"
        ? "净值接近样本高位且近 3 月涨幅较高，避免一次性追高"
        : timingStatus === "回落区"
          ? "净值处在样本较低区间，可优先考虑分批和止损线"
          : "价格位置不极端，重点比较同类和组合适配";

  const dataComponent = Math.round(dataScore * 0.25);
  const returnComponent =
    oneYearReturn?.peerPercentile !== null && oneYearReturn?.peerPercentile !== undefined
      ? Math.round(clamp((oneYearReturn.peerPercentile - 35) / 65, 0, 1) * 20)
      : oneYearReturn?.rankValue !== null && oneYearReturn?.rankValue !== undefined
        ? 10
        : 4;
  const drawdownTolerance = settings.maxDrawdownTolerance > 0 ? settings.maxDrawdownTolerance : 15;
  const riskComponent =
    maxDrawdown === null
      ? 8
      : Math.abs(maxDrawdown) <= drawdownTolerance * 0.55
        ? 20
        : Math.abs(maxDrawdown) <= drawdownTolerance
          ? 15
          : Math.abs(maxDrawdown) <= drawdownTolerance * 1.6
            ? 8
            : 3;
  const feeComponent = currentShareClass
    ? Math.max(4, 15 - Math.round(((currentShareClass.feeSummary.subscriptionRate ?? 0) + (currentShareClass.feeSummary.serviceRate ?? 0)) * 3))
    : fund.fees.length > 0
      ? 10
      : 4;
  const targetGap =
    oneYearReturn?.rankValue !== null && oneYearReturn?.rankValue !== undefined
      ? oneYearReturn.rankValue - settings.targetReturn
      : null;
  const timingComponent = timingStatus === "偏热" ? 4 : timingStatus === "回落区" ? 10 : 8;
  const maxPositionWeight = settings.riskProfile === "conservative" ? 15 : settings.riskProfile === "aggressive" ? 35 : 25;
  const portfolioComponent =
    currentPortfolioValue === 0
      ? 6
      : afterWeight <= maxPositionWeight * 0.7 && overlappingIndustries.length <= 1
        ? 10
        : afterWeight <= maxPositionWeight
          ? 7
          : 3;
  const totalScore = dataComponent + returnComponent + riskComponent + feeComponent + timingComponent + portfolioComponent;
  const conclusion =
    dataScore < 55
      ? "先补数据"
      : !purchaseOpen
        ? "先确认申购"
        : totalScore >= 78
          ? "可加入买入清单"
          : totalScore >= 62
            ? "适合观察等待"
            : "暂不建议买入";
  const action =
    conclusion === "可加入买入清单"
      ? "可以记录买入计划，但建议分批执行并设置复盘条件。"
      : conclusion === "适合观察等待"
        ? "先放入观察池，等待回撤、同类优势或资料完整度改善。"
        : conclusion === "先确认申购"
          ? "销售平台不可买或状态不明确，先核实开放状态。"
          : "先补齐数据和负面风险核对，不急于下单。";
  const scoreBreakdown = [
    { label: "数据", value: dataComponent, max: 25, detail: `${dataScore}/100，${formatSampleScope({ recentCount: fund.navs.length, totalCount: fund.navSampleTotal })}` },
    {
      label: "收益",
      value: returnComponent,
      max: 20,
      detail: oneYearReturn?.peerPercentile
        ? `近 1 年超过同类 ${formatNumber(oneYearReturn.peerPercentile, 1)}%，目标 ${formatNumber(settings.targetReturn, 1)}%`
        : "缺少完整同类百分位"
    },
    {
      label: "回撤",
      value: riskComponent,
      max: 20,
      detail: maxDrawdown === null ? "缺少回撤样本" : `样本最大回撤 ${formatNumber(maxDrawdown, 2)}%，你的上限 ${formatNumber(drawdownTolerance, 1)}%`
    },
    {
      label: "费用",
      value: feeComponent,
      max: 15,
      detail: currentShareClass ? `申购 ${formatNumber(currentShareClass.feeSummary.subscriptionRate, 2)}%，销售服务 ${formatNumber(currentShareClass.feeSummary.serviceRate, 2)}%` : "费率仍需补采"
    },
    { label: "时机", value: timingComponent, max: 10, detail: timingDetail },
    {
      label: "组合",
      value: portfolioComponent,
      max: 10,
      detail: currentPortfolioValue > 0 ? `买入 ¥${formatNumber(plannedAmount, 0)} 后占组合 ${formatNumber(afterWeight, 1)}%` : "尚未录入组合，无法判断集中度"
    }
  ];
  const positiveReasons = [
    dataScore >= 80 ? "数据可信度较高" : null,
    oneYearReturn?.peerPercentile && oneYearReturn.peerPercentile >= 70 ? "近 1 年同类表现靠前" : null,
    maxDrawdown !== null && maxDrawdown >= -10 ? "样本回撤相对温和" : null,
    fund.profile?.managerNames ? `经理：${fund.profile.managerNames}` : null,
    currentShareClass ? "费率可估算，适合比较 A/C 份额" : null
  ].filter((item): item is string => Boolean(item));
  const negativeRisks = [
    ...fund.warnings.map((item) => `${item.title}：${item.message}`),
    dataScore < 80 ? "数据覆盖仍未达到高可信标准" : null,
    maxDrawdown !== null && maxDrawdown <= -15 ? "历史回撤压力较大，需要确认最大可承受亏损" : null,
    oneYearReturn?.peerPercentile !== null && oneYearReturn?.peerPercentile !== undefined && oneYearReturn.peerPercentile < 45
      ? "近 1 年同类排名偏后"
      : null,
    targetGap !== null && targetGap < -3 ? `近 1 年收益低于你的目标约 ${formatNumber(Math.abs(targetGap), 1)} 个百分点` : null,
    afterWeight > maxPositionWeight ? `买入后单只基金仓位超过你的 ${formatNumber(maxPositionWeight, 1)}% 上限` : null,
    overlappingIndustries.length >= 2 ? `与现有组合行业重叠：${overlappingIndustries.map((item) => item.industryName).join("、")}` : null,
    !fund.profile ? "基金资料缺失，经理、规模、投资目标仍需补采" : null,
    fund.fees.length === 0 ? "费率缺失，无法估算真实持有成本" : null
  ].filter((item): item is string => Boolean(item));
  const riskProfiles = [
    {
      label: "稳健型",
      status: fitStatus(Boolean(purchaseOpen && dataScore >= 70 && maxDrawdown !== null && Math.abs(maxDrawdown) <= 8 && (volatility ?? 99) <= 8), dataScore >= 55),
      detail: "要求回撤小、波动低、资料完整，适合低亏损容忍度。"
    },
    {
      label: `你的档位：${riskProfileLabel(settings.riskProfile)}`,
      status: fitStatus(
        Boolean(purchaseOpen && dataScore >= 55 && (maxDrawdown === null || Math.abs(maxDrawdown) <= drawdownTolerance) && afterWeight <= maxPositionWeight),
        dataScore >= 45
      ),
      detail: `最大可承受回撤 ${formatNumber(drawdownTolerance, 1)}%，单只仓位上限 ${formatNumber(maxPositionWeight, 1)}%。`
    },
    {
      label: "均衡型",
      status: fitStatus(Boolean(purchaseOpen && dataScore >= 60 && (maxDrawdown === null || maxDrawdown >= -18)), dataScore >= 50),
      detail: "允许中等波动，重点看同类优势和组合分散。"
    },
    {
      label: "进取型",
      status: fitStatus(Boolean(purchaseOpen && dataScore >= 45), dataScore >= 35),
      detail: "可接受高波动，但仍需避免数据缺失和仓位过度集中。"
    }
  ];
  const watchFlow = [
    { label: "待研究", detail: "资料缺口、同类排名和费率没有核完前停留在这里。" },
    { label: "等待回调", detail: "若价格位置偏热，记录目标回撤或分批触发条件。" },
    { label: "准备买入", detail: "确认买入金额、仓位上限、止损/复盘条件后再记录交易。" },
    { label: "已买入复盘", detail: "买入后按经理、同类排名、回撤和仓位变化监控。" }
  ];
  const postBuyMonitors = [
    {
      label: "回撤线",
      detail: maxDrawdown === null ? "先补历史样本；买入后设置可承受回撤。" : `若从买入价回撤超过 ${formatNumber(drawdownTolerance, 1)}%，强制复盘。`
    },
    { label: "同类排名", detail: "近 3 月或近 1 年同类百分位跌破 40% 时复核是否继续持有。" },
    { label: "经理/公告", detail: "出现经理变更、限购、清盘、费率调整等公告时重新评估。" },
    { label: "组合仓位", detail: "单只基金超过 30% 或行业暴露超过上限时停止加仓。" }
  ];

  return {
    totalScore,
    conclusion,
    action,
    scoreBreakdown,
    positiveReasons,
    negativeRisks,
    riskProfiles,
    timing: {
      status: timingStatus,
      detail: timingDetail,
      navPosition,
      minNav,
      maxNav
    },
    portfolioImpact: {
      currentPortfolioValue,
      currentHoldingValue,
      currentWeight,
      afterWeight,
      plannedAmount,
      maxPositionWeight,
      overlappingIndustries,
      topIndustries,
      topStocks
    },
    costScenarios: [
      { label: "持有 7 天", value: estimateCost(currentShareClass?.feeSummary, 7, plannedAmount) },
      { label: "持有 30 天", value: estimateCost(currentShareClass?.feeSummary, 30, plannedAmount) },
      { label: "持有 1 年", value: estimateCost(currentShareClass?.feeSummary, 365, plannedAmount) }
    ],
    peerSnapshot: [
      { label: "近 3 月", item: threeMonthReturn },
      { label: "近 6 月", item: sixMonthReturn },
      { label: "近 1 年", item: oneYearReturn }
    ],
    watchFlow,
    postBuyMonitors,
    settings
  };
}

export default async function FundDetailPage({ params }: PageProps) {
  const { code } = await params;
  const [fund, portfolio] = await Promise.all([getFundDetail(decodeURIComponent(code)), getPortfolioDashboard()]);

  if (!fund) {
    notFound();
  }

  const [alternatives, alertRules] = await Promise.all([
    getFundAlternatives(fund.code, fund.fundType, 5),
    getAlertRulesForTarget("fund", fund.code)
  ]);
  const latest = fund.navs.at(-1);
  const chartData = fund.navs.map((nav) => ({
    date: formatDate(nav.tradeDate),
    value: nav.unitNav,
    changeRate: nav.dailyGrowthRate
  }));
  const oneYearReturn = fund.periodReturns.find((item) => item.rangeKey === "year_1");
  const threeMonthReturn = fund.periodReturns.find((item) => item.rangeKey === "month_3");
  const purchaseOpen = isOpenForPurchase(fund.purchaseStatus);
  const profileReady = Boolean(fund.profile);
  const feeReady = fund.fees.length > 0;
  const decisionSettings = parseDecisionSettings(fund.watchlistEntries[0]?.note);
  const simulation = fund.investmentSimulation;
  const shareClasses = fund.shareClassComparison.items;
  const shareClassBreakEven = fund.shareClassComparison.breakEven;
  const drawdownValue =
    fund.riskMetrics.maxDrawdown === null || fund.riskMetrics.maxDrawdown === undefined
      ? null
      : decisionSettings.plannedAmount * (1 + fund.riskMetrics.maxDrawdown / 100);
  const drawdownOk =
    fund.riskMetrics.maxDrawdown === null || fund.riskMetrics.maxDrawdown === undefined
      ? null
      : fund.riskMetrics.maxDrawdown >= -10;
  const navSampleCount = fund.navs.length;
  const dataCoverage = fund.dataCoverage;
  const dataScore = dataCoverage.score;
  const dataCoverageLabel = dataCoverage.label;
  const legacyDataScore =
    (navSampleCount >= 240 ? 35 : navSampleCount >= 60 ? 20 : navSampleCount >= 14 ? 10 : 0) +
    (fund.periodReturns.filter((item) => item.rankValue !== null && item.rankValue !== undefined).length >= 5 ? 25 : 0) +
    (profileReady ? 15 : 0) +
    (feeReady ? 15 : 0) +
    (fund.latestRating ? 10 : 0);
  const dataQuality = dataScore >= 80 ? "高" : dataScore >= 55 ? "中" : "低";
  const decisionTone =
    dataScore < 55
      ? "数据不足，先补历史和资料"
      : !purchaseOpen
        ? "申购受限，先确认交易平台状态"
        : fund.riskMetrics.maxDrawdown !== null && fund.riskMetrics.maxDrawdown <= -20
          ? "波动偏高，适合谨慎观察"
          : oneYearReturn?.peerPercentile && oneYearReturn.peerPercentile >= 80
            ? "同类表现靠前，可加入候选池继续比较"
            : "信息可读，继续比较同类和费用";
  const holdingParams = new URLSearchParams({
    targetType: "fund",
    targetKey: fund.code
  });
  if (latest?.unitNav) {
    holdingParams.set("costPrice", String(latest.unitNav));
  }
  const purchaseDecision = buildPurchaseDecision(fund, portfolio, purchaseOpen, dataScore, decisionSettings);
  const decisionQueueMissing = getDecisionQueueMissingFields(decisionSettings);
  const sampleScopeLabel = formatSampleScope({ recentCount: navSampleCount, totalCount: fund.navSampleTotal });
  const portfolioItem = portfolio.items.find((item) => item.targetType === "fund" && item.targetKey === fund.code);
  const currentShareClass = shareClasses.find((item) => item.isCurrent);
  const highImpactAnnouncementCount = fund.announcements.filter((item) => item.impact?.level === "high").length;
  const tradeWindow = getFundTradeWindow(new Date().toISOString(), latest?.tradeDate ?? null);
  const positionSizing = buildPositionSizing({
    currentPortfolioValue: portfolio.summary.currentValue,
    currentHoldingValue: portfolioItem?.currentValue ?? 0,
    plannedAmount: decisionSettings.plannedAmount,
    maxPositionWeight: purchaseDecision.portfolioImpact.maxPositionWeight
  });
  const tradeAction = buildFundTradeAction({
    held: Boolean(portfolioItem),
    dataScore,
    purchaseOpen,
    profitRate: portfolioItem?.profitRate ?? null,
    peerPercentile: oneYearReturn?.peerPercentile ?? null,
    maxDrawdown: fund.riskMetrics.maxDrawdown,
    maxDrawdownTolerance: decisionSettings.maxDrawdownTolerance,
    highImpactAnnouncementCount,
    positionStatus: positionSizing.status,
    tradeWindowState: tradeWindow.state
  });
  const sellReview = buildSellReviewSignals({
    profitRate: portfolioItem?.profitRate ?? null,
    targetReturn: decisionSettings.targetReturn,
    maxDrawdown: fund.riskMetrics.maxDrawdown,
    maxDrawdownTolerance: decisionSettings.maxDrawdownTolerance,
    peerPercentile: oneYearReturn?.peerPercentile ?? null,
    holdingDays: portfolioItem?.holdingDays ?? null,
    highImpactAnnouncementCount,
    redemptionRate: portfolioItem?.redemptionRate ?? currentShareClass?.feeSummary.redemptionRate ?? null
  });
  const tradeCostScenarios = buildTradingCostScenarios({
    feeSummary: currentShareClass?.feeSummary,
    amount: decisionSettings.plannedAmount,
    days: [7, 30, 180, 365]
  });
  const todayKey = chinaDateKey();
  const moneyRisk = buildMoneyRiskFrame({
    plannedAmount: decisionSettings.plannedAmount,
    currentValue: portfolioItem?.currentValue ?? decisionSettings.plannedAmount,
    profit: portfolioItem?.profit ?? 0,
    maxDrawdown: fund.riskMetrics.maxDrawdown,
    dailyRate: latest?.dailyGrowthRate ?? null
  });
  const redemptionPlan = buildRedemptionPlan({
    amount: portfolioItem?.currentValue ?? decisionSettings.plannedAmount,
    holdingDays: portfolioItem?.holdingDays ?? null,
    requestDate: todayKey,
    feeRows: fund.fees.map((item) => ({ conditionName: item.conditionName, feeValue: item.feeValue })),
    redemptionRate: portfolioItem?.redemptionRate ?? currentShareClass?.feeSummary.redemptionRate ?? null,
    settlementTradingDays: 1
  });
  const autoReviewPlan = buildAutoReviewPlan({
    baseDate: todayKey,
    targetReturn: decisionSettings.targetReturn,
    maxDrawdownTolerance: decisionSettings.maxDrawdownTolerance,
    peerFloor: 40
  });
  const mobileTradeCard = buildMobileTradeCard({
    action: tradeAction.action,
    suggestedAmount: positionSizing.status === "over_limit" ? null : positionSizing.suggestedAmount,
    tradeWindowLabel: tradeWindow.label,
    riskText: moneyRisk.plannedRiskText,
    primaryHref: "#daily-trade-reference"
  });
  const dataQualityExplanation = buildDataQualityExplanation({
    score: dataScore,
    checks: dataCoverage.checks,
    missingActions: dataCoverage.missingActions
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{fund.code}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{fund.name}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {fund.fundType ?? "基金"} · 申购 {fund.purchaseStatus ?? "--"} · 赎回 {fund.redeemStatus ?? "--"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/funds/${encodeURIComponent(fund.code)}/history`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            完整历史
          </Link>
          <Link href={`/funds/${encodeURIComponent(fund.code)}/profile`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            基金资料
          </Link>
          <WatchButton targetType="fund" code={fund.code} initialWatched={fund.watched} />
        </div>
      </div>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">今日操作</div>
            <div className="mt-1 text-base font-semibold text-ink">{tradeAction.intent === "buy" ? "买入参考" : tradeAction.intent === "sell_review" ? "卖出复盘" : "持有观察"}</div>
          </div>
          <a href={mobileTradeCard.primaryHref} className="focus-ring shrink-0 rounded-md bg-ink px-3 py-2 text-sm text-white">
            {mobileTradeCard.primaryAction}
          </a>
        </div>
        <div className="mt-3 grid gap-2">
          {mobileTradeCard.items.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm">
              <span className="shrink-0 text-slate-500">{item.label}</span>
              <span className="text-right font-medium text-ink">{item.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="daily-trade-reference" className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">今日交易参考</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {tradeAction.action}。{tradeAction.reasons.join(" ")}
            </p>
          </div>
          <span
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              tradeAction.priority === "high" ? "bg-coral/10 text-coral" : tradeAction.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-mint/10 text-mint"
            }`}
          >
            {tradeAction.intent === "buy" ? "买入参考" : tradeAction.intent === "sell_review" ? "卖出复盘" : tradeAction.intent === "hold" ? "持有观察" : "暂不交易"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <TradeMetric title="交易窗口" value={tradeWindow.label} detail={tradeWindow.detail} />
          <TradeMetric
            title="买多少"
            value={positionSizing.status === "over_limit" ? "不建议加仓" : `¥${formatNumber(positionSizing.suggestedAmount, 0)}`}
            detail={`${positionSizing.message} 计划买入后仓位 ${formatNumber(positionSizing.afterPlannedWeight, 1)}%。`}
          />
          <TradeMetric
            title="卖出/持有复盘"
            value={sellReview.conclusion}
            detail={sellReview.signals[0]?.detail ?? "暂未触发止盈、止损、排名恶化或公告风险。"}
          />
          <TradeMetric
            title="真实成本"
            value={tradeCostScenarios[0]?.cost === null ? "费率待确认" : `¥${formatNumber(tradeCostScenarios[0]?.cost, 2)}`}
            detail={`${tradeCostScenarios[0]?.label ?? "持有 7 天"}${tradeCostScenarios[0]?.warning ? `：${tradeCostScenarios[0].warning}` : "估算申购、服务、管理、托管和赎回成本。"} `}
          />
          <TradeMetric
            title="金额化风险"
            value={moneyRisk.plannedDrawdownLoss === null ? "待估算" : `¥${formatNumber(moneyRisk.plannedDrawdownLoss, 0)}`}
            detail={`${moneyRisk.plannedRiskText}；${moneyRisk.dailyMoveText}。`}
          />
        </div>
        <div className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">仓位变化</div>
            <div className="mt-2 text-slate-600">
              当前 {formatNumber(positionSizing.currentWeight, 1)}% · 计划后 {formatNumber(positionSizing.afterPlannedWeight, 1)}% · 上限{" "}
              {formatNumber(purchaseDecision.portfolioImpact.maxPositionWeight, 1)}%
            </div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">人民币影响</div>
            <div className="mt-2 grid gap-1 text-slate-600">
              <div>{moneyRisk.currentProfitText}</div>
              <div>{moneyRisk.dailyMoveText}</div>
            </div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">复盘信号</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              {sellReview.signals.length
                ? sellReview.signals.map((item) => (
                    <span key={item.key} className="rounded-md border border-line bg-white px-2 py-1">
                      {item.title}
                    </span>
                  ))
                : "暂无触发项"}
            </div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">赎回到账</div>
            <div className="mt-2 text-slate-600">
              预计 {redemptionPlan.estimatedArrivalDate} 到账 · 费率{" "}
              {redemptionPlan.currentRate === null ? "待确认" : `${formatNumber(redemptionPlan.currentRate, 2)}%`}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {redemptionPlan.currentFee === null ? "缺少赎回费率" : `按当前金额估算约 ¥${formatNumber(redemptionPlan.currentFee, 2)}`}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">成本场景</div>
            <div className="mt-2 grid gap-1 text-slate-600">
              {tradeCostScenarios.map((item) => (
                <div key={item.days} className="flex justify-between gap-3">
                  <span>{item.label}</span>
                  <span>{item.cost === null ? "待确认" : `¥${formatNumber(item.cost, 2)}`}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="font-medium text-ink">买后复盘计划</div>
            <div className="mt-2 grid gap-2">
              {autoReviewPlan.items.slice(0, 4).map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-3">
                  <span className="text-slate-600">{item.title}</span>
                  <span className="max-w-[65%] text-right text-slate-500">{item.date ?? item.detail}</span>
                </div>
              ))}
            </div>
          </div>
          {redemptionPlan.ladder.length ? (
            <div className="rounded-md border border-line bg-paper p-3 lg:col-span-2">
              <div className="font-medium text-ink">赎回费阶梯</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                {redemptionPlan.ladder.slice(0, 6).map((item) => (
                  <span key={`${item.condition}-${item.rate}`} className="rounded-md border border-line bg-white px-2 py-1">
                    {item.condition}：{formatNumber(item.rate, 2)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <div>
            <h2 className="text-lg font-semibold text-ink">一句话风险结论</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{decisionTone}。这不是买卖建议，实际操作前还要结合你的仓位、持有期限和可承受回撤。</p>
          </div>
          <DecisionMetric label="数据可信度" value={dataQuality} helper={`${dataScore}/100 · ${sampleScopeLabel}`} />
          <DecisionMetric
            label="研究优先级"
            value={purchaseOpen && dataScore >= 55 ? "可研究" : "先补充"}
            helper={purchaseOpen ? "申购状态可继续核对" : "申购状态需要确认"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <BackfillButton action="fund_full" code={fund.code} label="一键补本基金" />
          <BackfillButton action="fund_history" code={fund.code} label="补 3 年净值" />
          <BackfillButton action="fund_profile" code={fund.code} label="补资料/费率/持仓" />
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">数据可信度</h2>
            <p className="mt-1 text-sm text-slate-600">{dataCoverage.summary}</p>
          </div>
          <div className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-slate-600">
            类型：{fund.fundType ?? "--"} · 来源：{fund.fundTypeSource ?? "--"} · {sampleScopeLabel}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {dataCoverage.checks.map((item) => (
            <ChecklistItem key={item.key} label={item.label} status={item.status} detail={item.detail} />
          ))}
        </div>
        {dataCoverage.missingActions.length ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-3 text-sm text-slate-600">
            <div className="font-medium text-ink">建议补数</div>
            <div className="mt-1">{dataCoverage.missingActions.join(" / ")}</div>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 text-sm lg:grid-cols-3">
          <DataQualityBucket
            title="优先补齐"
            emptyText="暂无必须补齐项"
            items={dataQualityExplanation.missing.map((item) => `${item.label}：${item.detail}`)}
          />
          <DataQualityBucket
            title="需要留意"
            emptyText="暂无明显警告"
            items={dataQualityExplanation.warnings.map((item) => `${item.label}：${item.detail}`)}
          />
          <DataQualityBucket
            title="已满足"
            emptyText="暂无已满足项"
            items={dataQualityExplanation.ok.map((item) => `${item.label}：${item.detail}`)}
          />
        </div>
      </section>

      <PurchaseDecisionForm code={fund.code} settings={decisionSettings} watched={fund.watched} />

      <AlertRuleForm
        targetType="fund"
        targetKey={fund.code}
        initialRules={alertRules.map((item) => ({
          id: item.id,
          metric: item.metric,
          threshold: item.threshold,
          enabled: item.enabled,
          note: item.note
        }))}
        defaults={{
          targetReturn: decisionSettings.targetReturn,
          maxPositionWeight: purchaseDecision.portfolioImpact.maxPositionWeight
        }}
      />

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">关注决策队列</h2>
            <p className="mt-1 text-sm text-slate-600">关注不只收藏标的，还要记录买入条件、放弃条件和复盘日期。</p>
          </div>
          <span className={`rounded-md px-3 py-2 text-sm font-medium ${decisionQueueMissing.length ? "bg-amber-100 text-amber-700" : "bg-mint/10 text-mint"}`}>
            {decisionQueueMissing.length ? `待补 ${decisionQueueMissing.length} 项` : "可执行"}
          </span>
        </div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <Field label="买入条件" value={decisionSettings.buyCondition || "未填写"} />
          <Field label="放弃条件" value={decisionSettings.rejectCondition || "未填写"} />
          <Field label="复盘日期" value={decisionSettings.reviewDate || "未填写"} />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
        <div className="bg-[linear-gradient(135deg,#102a43,#1f6f8b)] p-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-white/65">Buy Decision Center</div>
              <h2 className="mt-2 text-2xl font-semibold">购买决策中心</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">
                把结论、风险匹配、同类对比、买入时机、组合影响、费用、观察流程、负面风险、买后监控和评分解释放在同一个入口，减少下单前的来回跳转。
              </p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-right backdrop-blur">
              <div className="text-sm text-white/70">综合购买分</div>
              <div className="mt-1 text-4xl font-semibold">{purchaseDecision.totalScore}</div>
              <DecisionPill label={purchaseDecision.conclusion} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-line bg-paper p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">1. 购买结论</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{purchaseDecision.action}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/portfolio?${holdingParams.toString()}`}
                  className="focus-ring rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
                >
                  记录买入
                </Link>
                <AddCompareButton targetType="fund" targetKey={fund.code} name={fund.name} />
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DecisionMetric
                label="申购状态"
                value={fund.purchaseStatus ?? "--"}
                helper={purchaseOpen ? "当前状态允许继续核对买入" : "买入前先确认销售平台是否可申购"}
              />
              <DecisionMetric
                label="样本最大回撤"
                value={fund.riskMetrics.maxDrawdown === null ? "--" : `${formatNumber(fund.riskMetrics.maxDrawdown, 2)}%`}
                helper={
                  drawdownValue === null
                    ? "净值样本不足"
                    : `买入 ¥${formatNumber(purchaseDecision.portfolioImpact.plannedAmount, 0)} 样本低点约 ${formatNumber(drawdownValue, 0)} 元`
                }
              />
              <DecisionMetric
                label="价格位置"
                value={purchaseDecision.timing.status}
                helper={
                  purchaseDecision.timing.navPosition === null
                    ? purchaseDecision.timing.detail
                    : `处于样本区间 ${formatNumber(purchaseDecision.timing.navPosition, 1)}% 位置`
                }
              />
              <DecisionMetric
                label="买入后仓位"
                value={`${formatNumber(purchaseDecision.portfolioImpact.afterWeight, 1)}%`}
                helper={
                  purchaseDecision.portfolioImpact.currentPortfolioValue > 0
                    ? `按新增 ¥${formatNumber(purchaseDecision.portfolioImpact.plannedAmount, 0)} 估算`
                    : "尚未录入组合，先按单只 100% 提醒"
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-4">
            <details>
              <summary className="focus-ring cursor-pointer list-none rounded text-lg font-semibold text-ink">评分解释</summary>
              <div className="mt-4 space-y-3">
                {purchaseDecision.scoreBreakdown.map((item) => (
                  <ScoreRow key={item.label} label={item.label} value={item.value} max={item.max} detail={item.detail} />
                ))}
              </div>
            </details>
          </div>
        </div>

        <div className="grid gap-4 px-4 pb-4 xl:grid-cols-3">
          <DecisionPanel title="2. 风险匹配" description="先匹配你的承受能力，再谈收益。" defaultOpen>
            <div className="space-y-2">
              {purchaseDecision.riskProfiles.map((item) => (
                <ChecklistItem key={item.label} label={item.label} status={item.status} detail={item.detail} />
              ))}
            </div>
          </DecisionPanel>

          <DecisionPanel title="3. 同类对比" description="只和同类型基金比较，避免跨品类误判。">
            <div className="space-y-3 text-sm">
              {purchaseDecision.peerSnapshot.map((snapshot) => (
                <div key={snapshot.label} className="rounded-md border border-line bg-paper p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{snapshot.label}</span>
                    <TrendBadge value={snapshot.item?.rankValue} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {snapshot.item?.peerRank && snapshot.item.peerTotal
                      ? `同类第 ${snapshot.item.peerRank}/${snapshot.item.peerTotal}，超过 ${formatNumber(snapshot.item.peerPercentile, 1)}%`
                      : "同类百分位不足"}
                  </div>
                </div>
              ))}
            </div>
          </DecisionPanel>

          <DecisionPanel title="4. 买入时机" description="不预测涨跌，只提示追高和分批风险。" defaultOpen>
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="font-semibold text-ink">{purchaseDecision.timing.status}</div>
              <p className="mt-2 leading-6 text-slate-600">{purchaseDecision.timing.detail}</p>
              <div className="mt-3 text-xs text-slate-500">
                样本低点 {formatNumber(purchaseDecision.timing.minNav, 4)} · 样本高点 {formatNumber(purchaseDecision.timing.maxNav, 4)}
              </div>
            </div>
          </DecisionPanel>

          <DecisionPanel title="5. 组合影响" description="看买入后是否让组合更集中。" defaultOpen>
            <div className="space-y-3 text-sm">
              <Field label="当前该基金仓位" value={`${formatNumber(purchaseDecision.portfolioImpact.currentWeight, 1)}%`} />
              <Field label="观察状态" value={statusLabel(purchaseDecision.settings.observationStatus)} />
              <Field label="买入后仓位" value={`${formatNumber(purchaseDecision.portfolioImpact.afterWeight, 1)}%`} />
              <Field label="仓位上限" value={`${formatNumber(purchaseDecision.portfolioImpact.maxPositionWeight, 1)}%`} />
              <Field
                label="行业重叠"
                value={
                  purchaseDecision.portfolioImpact.overlappingIndustries.length
                    ? purchaseDecision.portfolioImpact.overlappingIndustries.map((item) => item.industryName).join("、")
                    : "暂无明显重叠"
                }
              />
            </div>
          </DecisionPanel>

          <DecisionPanel title="6. 费用成本" description={`按计划买入 ¥${formatNumber(purchaseDecision.portfolioImpact.plannedAmount, 0)} 估算，不含平台折扣。`}>
            <div className="grid gap-2 text-sm">
              {tradeCostScenarios.map((item) => (
                <div key={item.days} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2">
                  <span className="text-slate-600">{item.label}</span>
                  <span className="text-right font-semibold text-ink">
                    {item.cost === null ? "费率待确认" : `¥${formatNumber(item.cost, 2)}`}
                    {item.warning ? <span className="ml-2 text-xs font-normal text-amber-700">{item.warning}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </DecisionPanel>

          <DecisionPanel title="7. 观察到买入" description="把关注变成有状态的决策流程。">
            <ol className="space-y-2 text-sm">
              {purchaseDecision.watchFlow.map((item, index) => (
                <li key={item.label} className="rounded-md border border-line bg-paper p-3">
                  <div className="font-medium text-ink">{index + 1}. {item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</div>
                </li>
              ))}
            </ol>
          </DecisionPanel>
        </div>

        <div className="grid gap-4 px-4 pb-4 xl:grid-cols-3">
          <DecisionPanel title="8. 不买理由" description="先看负面清单，避免只看亮点。">
            <ReasonList items={purchaseDecision.negativeRisks.length ? purchaseDecision.negativeRisks : ["暂无明显负面触发项"]} />
          </DecisionPanel>

          <DecisionPanel title="9. 买后监控" description="买入理由失效时触发复盘。">
            <div className="space-y-2">
              {purchaseDecision.postBuyMonitors.map((item) => (
                <ChecklistItem key={item.label} label={item.label} status="warn" detail={item.detail} />
              ))}
            </div>
          </DecisionPanel>

          <DecisionPanel title="买入理由" description="如果无法写清这些理由，就不要急着下单。">
            <ReasonList items={purchaseDecision.positiveReasons.length ? purchaseDecision.positiveReasons : ["暂无足够强的正向理由"]} />
          </DecisionPanel>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="最新净值" value={formatNumber(latest?.unitNav)} />
        <Info label="累计净值" value={formatNumber(latest?.accumulatedNav)} />
        <Info label="日增长率" value={<TrendBadge value={latest?.dailyGrowthRate} />} />
        <Info label="交易日" value={formatDate(latest?.tradeDate)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="样本最大回撤" value={<TrendBadge value={fund.riskMetrics.maxDrawdown} />} />
        <Info label="年化波动率" value={`${formatNumber(fund.riskMetrics.volatility, 2)}%`} />
        <Info label="夏普比率" value={formatNumber(fund.riskMetrics.sharpe, 2)} />
        <Info label="样本年化收益" value={<TrendBadge value={fund.riskMetrics.annualizedReturn} />} />
      </section>

      {fund.fundClassification.assetMode !== "open" ? (
        <section className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">专项数据</h2>
          <p className="mt-1 text-sm text-slate-600">
            {fund.fundClassification.assetMode === "money"
              ? "货币基金优先看万份收益和七日年化，单位净值涨跌不适合作为主要判断。"
              : fund.fundClassification.assetMode === "exchange"
                ? "ETF/LOF 需要同时看场内价格、成交额和折溢价，净值涨跌不能完整反映交易成本。"
                : fund.fundClassification.assetMode === "qdii"
                  ? "QDII 净值通常滞后，买前需要额外留意估值日期和海外市场波动。"
                  : "该类型基金需要结合专属指标查看。"}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fund.fundClassification.assetMode === "money" ? (
              <>
                <Info label="万份收益" value={formatNumber(fund.latestMoneyData?.tenThousandIncome, 4)} />
                <Info label="七日年化" value={<TrendBadge value={fund.latestMoneyData?.sevenDayAnnualized} />} />
                <Info label="货币数据日" value={formatDate(fund.latestMoneyData?.tradeDate)} />
                <Info label="购买状态" value={fund.latestMoneyData?.purchaseStatus ?? fund.purchaseStatus ?? "--"} />
              </>
            ) : null}
            {fund.fundClassification.assetMode === "exchange" ? (
              <>
                <Info label="场内价格" value={formatNumber(fund.latestExchangeQuote?.latestPrice, 4)} />
                <Info label="场内涨跌" value={<TrendBadge value={fund.latestExchangeQuote?.changeRate} />} />
                <Info label="折溢价" value={<TrendBadge value={fund.latestExchangeQuote?.discountRate} />} />
                <Info label="成交额" value={formatNumber(fund.latestExchangeQuote?.amount, 2)} />
              </>
            ) : null}
            {fund.fundClassification.assetMode === "qdii" ? (
              <>
                <Info label="最新净值日" value={formatDate(latest?.tradeDate)} />
                <Info label="近 1 月" value={<TrendBadge value={fund.periodReturns.find((item) => item.rangeKey === "month_1")?.rankValue} />} />
                <Info label="近 1 年" value={<TrendBadge value={oneYearReturn?.rankValue} />} />
                <Info label="数据提醒" value="注意净值滞后" />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">买入前核对</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="基金经理" value={fund.profile?.managerNames} />
            <Field label="基金规模" value={fund.profile?.latestScale} />
            <Field label="基金公司" value={fund.profile?.fundCompany} />
            <Field label="成立时间" value={formatDate(fund.profile?.inceptionDate)} />
            <Field label="申购状态" value={fund.purchaseStatus} />
            <Field label="赎回状态" value={fund.redeemStatus} />
            <Field label="评级家数" value={fund.latestRating?.fiveStarCount?.toString()} />
            <Field label="首条费率" value={fund.fees[0]?.feeValue} />
          </div>
        </div>
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">风险提醒</h2>
          <div className="mt-3 space-y-3">
            {fund.warnings.length === 0 ? (
              <p className="text-sm text-slate-500">暂无触发的持有风险提醒。</p>
            ) : (
              fund.warnings.map((item) => (
                <div className="rounded-md border border-line bg-paper p-3 text-sm" key={`${item.metric}-${item.title}`}>
                  <div className="font-medium text-ink">{item.title}</div>
                  <div className="mt-1 text-slate-600">{item.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">阶段收益</h2>
            <p className="mt-1 text-sm text-slate-600">来自开放式基金排行数据，展示各周期最新可用收益率。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {fund.periodReturns.map((item) => (
            <div className="rounded-md border border-line bg-paper px-3 py-3" key={item.rangeKey}>
              <div className="text-sm text-slate-600">{item.label}</div>
              <div className="mt-2 text-lg font-semibold">
                <TrendBadge value={item.rankValue} />
              </div>
              <div className="mt-1 text-xs text-slate-500">排行日 {formatDate(item.rankDate)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {item.peerRank && item.peerTotal
                  ? `同类 ${item.peerRank}/${item.peerTotal} · 超过 ${formatNumber(item.peerPercentile, 1)}%`
                  : "同类百分位不足"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">同类替代基金</h2>
            <p className="mt-1 text-sm text-slate-600">同类型里优先看回撤、观察分和近 1 年表现，避免只盯当前这只。</p>
          </div>
          <AddCompareButton targetType="fund" targetKey={fund.code} name={fund.name} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          {alternatives.length === 0 ? (
            <div className="rounded-md border border-line bg-paper p-3 text-sm text-slate-500 lg:col-span-5">暂无足够同类替代样本。</div>
          ) : (
            alternatives.map((item) => (
              <div key={item.code} className="rounded-md border border-line bg-paper p-3 text-sm">
                <Link href={`/funds/${encodeURIComponent(item.code)}`} className="focus-ring rounded font-medium text-ink">
                  {item.name}
                </Link>
                <div className="mt-1 text-xs text-slate-500">{item.code} · {item.fundType ?? "--"}</div>
                <div className="mt-3 grid gap-1 text-xs text-slate-600">
                  <div className="flex justify-between gap-2">
                    <span>观察分</span>
                    <span className="font-medium text-ink">{item.observationScore}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>最大回撤</span>
                    <TrendBadge value={item.maxDrawdown} />
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>近 1 年</span>
                    <TrendBadge value={item.year1Return} />
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>同类百分位</span>
                    <span>{formatNumber(item.peerPercentile, 1)}%</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">A/C 份额费用对比</h2>
          <p className="mt-1 text-sm text-slate-600">
            按同名基金识别份额，估算 1 万元持有 30 天和 1 年的申购费与销售服务费成本。
          </p>
          {shareClassBreakEven ? (
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">A/C 临界天数</div>
                <div className="mt-1 font-semibold text-ink">
                  {shareClassBreakEven.breakEvenDays === null ? "暂无明显临界点" : `约 ${formatNumber(shareClassBreakEven.breakEvenDays, 0)} 天`}
                </div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 30 天</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better30d.cost === null ? "费率待确认" : `${shareClassBreakEven.better30d.shareClass} 类成本低`}</div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 90 天</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better90d.cost === null ? "费率待确认" : `${shareClassBreakEven.better90d.shareClass} 类成本低`}</div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 1 年</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better365d.cost === null ? "费率待确认" : `${shareClassBreakEven.better365d.shareClass} 类成本低`}</div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">份额</th>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 text-right font-medium">近1年收益</th>
                <th className="px-4 py-3 text-right font-medium">申购费</th>
                <th className="px-4 py-3 text-right font-medium">销售服务费</th>
                <th className="px-4 py-3 text-right font-medium">30天成本</th>
                <th className="px-4 py-3 text-right font-medium">1年成本</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shareClasses.length <= 1 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    暂未识别到同名 A/C 份额，或费率数据仍需补采。
                  </td>
                </tr>
              ) : (
                shareClasses.map((item) => (
                  <tr key={item.code} className={item.isCurrent ? "bg-paper/70" : undefined}>
                    <td className="px-4 py-3 font-medium">{item.shareClass}</td>
                    <td className="px-4 py-3">
                      <Link href={`/funds/${encodeURIComponent(item.code)}`} className="focus-ring rounded font-medium text-ink">
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.yearReturn} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.feeSummary.subscriptionRate, 2)}%</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.feeSummary.serviceRate, 2)}%</td>
                    <td className="px-4 py-3 text-right">{item.cost30d === null ? "费率待确认" : `¥${formatNumber(item.cost30d, 2)}`}</td>
                    <td className="px-4 py-3 text-right">{item.cost365d === null ? "费率待确认" : `¥${formatNumber(item.cost365d, 2)}`}</td>
                    <td className="px-4 py-3 text-slate-600">{item.purchaseStatus ?? "--"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">定投模拟</h2>
            <p className="mt-1 text-sm text-slate-600">按每月 1,000 元、每月首个净值日买入估算，不含申赎费和分红再投。</p>
          </div>
        </div>
        {simulation ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="定投期数" value={`${simulation.months} 期`} />
            <Info label="累计投入" value={`¥${formatNumber(simulation.invested, 2)}`} />
            <Info label="当前市值" value={`¥${formatNumber(simulation.currentValue, 2)}`} />
            <Info label="定投收益率" value={<TrendBadge value={simulation.profitRate} />} />
            <Info label="最大浮亏" value={<TrendBadge value={simulation.maxFloatingLoss} />} />
            <Info label="一次性买入收益" value={<TrendBadge value={simulation.lumpProfitRate} />} />
            <Info label="开始日期" value={formatDate(simulation.startDate)} />
            <Info label="结束日期" value={formatDate(simulation.endDate)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">净值样本不足，暂不能模拟定投。</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">单位净值曲线</h2>
        <NavChart data={chartData} valueLabel="单位净值" />
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">分红配送</h2>
          <p className="mt-1 text-sm text-slate-600">现金分红按每份和每 10 份展示；ETF 数据按累计分红展示。</p>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">权益登记日</th>
                <th className="px-4 py-3 font-medium">除息日</th>
                <th className="px-4 py-3 font-medium">发放日</th>
                <th className="px-4 py-3 text-right font-medium">每10份</th>
                <th className="px-4 py-3 text-right font-medium">累计分红</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fund.dividends.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    暂无结构化分红数据
                  </td>
                </tr>
              ) : (
                fund.dividends.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.dividendType}</td>
                    <td className="px-4 py-3">{formatDate(item.registrationDate)}</td>
                    <td className="px-4 py-3">{formatDate(item.exDividendDate)}</td>
                    <td className="px-4 py-3">{formatDate(item.paymentDate)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.dividendPer10, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.cumulativeDividend, 4)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">最近净值</h2>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">累计净值</th>
                <th className="px-4 py-3 text-right font-medium">日增长值</th>
                <th className="px-4 py-3 text-right font-medium">日增长率</th>
                <th className="px-4 py-3 font-medium">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...fund.navs].reverse().slice(0, 30).map((nav) => (
                <tr key={nav.id}>
                  <td className="px-4 py-3">{formatDate(nav.tradeDate)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.unitNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.accumulatedNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.dailyGrowthValue)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={nav.dailyGrowthRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nav.growthRateSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <h2 className="font-semibold text-ink">公告</h2>
        <div className="mt-3 divide-y divide-line">
          {fund.announcements.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">暂无公告</p>
          ) : (
            fund.announcements.map((item) => (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring block rounded py-3 text-sm"
                key={item.id}
              >
                <span className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span>{item.title}</span>
                  <span className={`rounded-md px-2 py-1 text-xs ${announcementImpactClass(item.impact?.level)}`}>
                    {item.impact?.label ?? "低影响"}
                  </span>
                </span>
                <span className="mt-1 block text-slate-500">
                  {item.source} · {formatDate(item.publishedAt)} · {item.impact?.reason ?? "普通公告"}
                </span>
              </a>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600 shadow-panel">
        <h2 className="font-semibold text-ink">口径说明</h2>
        <p className="mt-2">
          阶段收益优先使用开放式基金排行数据；净值曲线使用单位净值。最大回撤、波动率和夏普比率基于本地已采集净值样本计算，不替代基金公司正式披露口径。
        </p>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-ink">{value || "--"}</div>
    </div>
  );
}

function DecisionMetric({ label, value, helper }: { label: string; value: ReactNode; helper: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function TradeMetric({ title, value, detail }: { title: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="text-sm text-slate-600">{title}</div>
      <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function DecisionPill({ label }: { label: string }) {
  const className =
    label === "可加入买入清单"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : label === "适合观察等待"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <div className={`mt-3 rounded-full border px-3 py-1 text-sm font-medium ${className}`}>
      {label}
    </div>
  );
}

function ScoreRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-slate-500">
          {value}/{max}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-steel" style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function DecisionPanel({
  title,
  description,
  children,
  defaultOpen = false
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rounded-xl border border-line bg-white p-4" open={defaultOpen}>
      <summary className="focus-ring cursor-pointer list-none rounded">
        <h3 className="inline text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function ReasonList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.slice(0, 6).map((item) => (
        <li key={item} className="rounded-md border border-line bg-paper px-3 py-2 leading-5 text-slate-700">
          {item}
        </li>
      ))}
    </ul>
  );
}

function DataQualityBucket({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="font-medium text-ink">{title}</div>
      <ul className="mt-2 space-y-1 text-slate-600">
        {items.length ? items.slice(0, 4).map((item) => <li key={item}>{item}</li>) : <li>{emptyText}</li>}
      </ul>
    </div>
  );
}

function ChecklistItem({
  label,
  status,
  detail
}: {
  label: string;
  status: "ok" | "warn" | "missing";
  detail: string;
}) {
  const className =
    status === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${className}`}>
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-xs">{detail}</div>
    </div>
  );
}

function announcementImpactClass(level: string | undefined) {
  if (level === "high") {
    return "bg-coral/10 text-coral";
  }
  if (level === "medium") {
    return "bg-steel/10 text-steel";
  }
  return "bg-mint/10 text-mint";
}
