import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourcePath = join(root, "lib", "fund-ux.ts");
const compiledPath = join(root, ".tmp-tests", "fund-ux.cjs");

after(() => {
  rmSync(join(root, ".tmp-tests"), { recursive: true, force: true });
});

function loadFundUx() {
  const source = readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  mkdirSync(dirname(compiledPath), { recursive: true });
  writeFileSync(compiledPath, output);
  const require = createRequire(import.meta.url);
  delete require.cache[compiledPath];
  return require(compiledPath);
}

test("fund UX rule module exists", () => {
  assert.equal(existsSync(sourcePath), true);
});

test("candidate tiers keep the strong bucket selective", () => {
  const { assignCandidateTiers } = loadFundUx();
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    code: String(index).padStart(6, "0"),
    observationScore: 96 - index * 0.2,
    dataScore: 80,
    purchaseStatus: "开放申购",
    watched: false
  }));

  const tiered = assignCandidateTiers(candidates);

  assert.equal(tiered.filter((item) => item.observationTier === "strong").length, 60);
  assert.equal(tiered[59].observationTier, "strong");
  assert.equal(tiered[60].observationTier, "watchable");
});

test("sample labels distinguish recent detail samples from full history", () => {
  const { formatSampleScope } = loadFundUx();

  assert.equal(formatSampleScope({ recentCount: 380, totalCount: 759 }), "近一年样本 380 条 / 全历史 759 条");
  assert.equal(formatSampleScope({ recentCount: 240, totalCount: 240 }), "样本 240 条");
});

test("fee cost estimates are unknown when no parsed rates exist", () => {
  const { estimateKnownFeeCost, hasKnownFeeRate } = loadFundUx();
  const emptySummary = {
    subscriptionRate: null,
    serviceRate: null,
    managementRate: null,
    custodyRate: null,
    redemptionRate: null
  };

  assert.equal(hasKnownFeeRate(emptySummary), false);
  assert.equal(estimateKnownFeeCost(emptySummary, 30, 10000), null);
  assert.equal(
    estimateKnownFeeCost({ ...emptySummary, managementRate: 1.2 }, 365, 10000),
    120
  );
});

test("compare target parser accepts search-style input and removes duplicates", () => {
  const { parseCompareTargets } = loadFundUx();

  assert.deepEqual(parseCompareTargets("011815, fund:011815\nwealth:ABC, 000001"), [
    "fund:011815",
    "wealth:ABC",
    "fund:000001"
  ]);
});

test("decision queue settings expose missing action conditions", () => {
  const { getDecisionQueueMissingFields } = loadFundUx();

  assert.deepEqual(
    getDecisionQueueMissingFields({
      observationStatus: "researching",
      buyCondition: "",
      rejectCondition: "",
      reviewDate: ""
    }),
    ["买入条件", "放弃条件", "复盘日期"]
  );
  assert.deepEqual(
    getDecisionQueueMissingFields({
      observationStatus: "waiting_pullback",
      buyCondition: "回撤 8% 后分批",
      rejectCondition: "经理变更",
      reviewDate: "2026-05-28"
    }),
    []
  );
});

test("daily highlights prioritize stale data and watched fund moves", () => {
  const { buildDailyHighlights } = loadFundUx();

  const highlights = buildDailyHighlights({
    fundNavDate: "2026-04-27T00:00:00.000Z",
    asOfDate: "2026-04-28T00:00:00.000Z",
    newStrongCandidates: 12,
    watchedMoves: [
      { code: "011815", name: "恒越优势精选混合A", dailyGrowthRate: -3.2 },
      { code: "006081", name: "海富通电子传媒股票A", dailyGrowthRate: 2.8 }
    ],
    rankingMoves: [{ code: "011815", name: "恒越优势精选混合A", rangeLabel: "近 1 年", rankValue: 213.53 }],
    latestSyncStatus: "success"
  });

  assert.equal(highlights[0].level, "high");
  assert.match(highlights[0].title, /关注基金波动/);
  assert.ok(highlights.some((item) => item.title.includes("新增重点观察")));
});

test("investment preferences normalize unsafe input into usable defaults", () => {
  const { normalizeInvestmentPreferences } = loadFundUx();

  assert.deepEqual(normalizeInvestmentPreferences({ riskProfile: "unknown", plannedAmount: -1 }), {
    riskProfile: "balanced",
    plannedAmount: 10000,
    maxDrawdownTolerance: 15,
    targetReturn: 8,
    maxPositionWeight: 25
  });
  assert.equal(normalizeInvestmentPreferences({ riskProfile: "aggressive" }).maxPositionWeight, 35);
});

test("watchlist decisions group by next action status", () => {
  const { groupWatchlistDecisions } = loadFundUx();
  const grouped = groupWatchlistDecisions([
    { code: "1", observationStatus: "ready_to_buy", reviewDate: "2026-05-02" },
    { code: "2", observationStatus: "researching", reviewDate: "2026-05-01" },
    { code: "3", observationStatus: "ready_to_buy", reviewDate: "2026-04-30" }
  ]);

  assert.deepEqual(grouped.ready_to_buy.map((item) => item.code), ["3", "1"]);
  assert.deepEqual(grouped.researching.map((item) => item.code), ["2"]);
});

test("alert action state hides handled alerts and keeps snoozed alerts visible later", () => {
  const { applyAlertActionState } = loadFundUx();
  const alerts = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" }
  ];

  const visible = applyAlertActionState(alerts, {
    a: { action: "done" },
    b: { action: "snooze", until: "2026-04-29" }
  }, "2026-04-28");

  assert.deepEqual(visible.map((item) => item.id), ["c"]);
});

test("comparison winners pick higher returns and lower risk", () => {
  const { getComparisonWinnerKeys } = loadFundUx();

  assert.deepEqual(getComparisonWinnerKeys([
    { key: "a", value: 5 },
    { key: "b", value: 9 },
    { key: "c", value: null }
  ], "higher"), ["b"]);
  assert.deepEqual(getComparisonWinnerKeys([
    { key: "a", value: -20 },
    { key: "b", value: -8 }
  ], "lowerAbs"), ["b"]);
});

test("table mode switches to cards for narrow screens", () => {
  const { getResponsiveTableMode } = loadFundUx();

  assert.equal(getResponsiveTableMode(390), "cards");
  assert.equal(getResponsiveTableMode(1024), "table");
});

test("data quality explanation surfaces missing actions first", () => {
  const { buildDataQualityExplanation } = loadFundUx();

  const explanation = buildDataQualityExplanation({
    score: 55,
    checks: [
      { key: "nav", label: "NAV", status: "ok", detail: "ok" },
      { key: "fee", label: "Fee", status: "missing", detail: "missing" }
    ],
    missingActions: ["补费率"]
  });

  assert.equal(explanation.primaryAction, "补费率");
  assert.equal(explanation.missing.length, 1);
});

test("snapshot freshness expires stale precomputed data", () => {
  const { isSnapshotFresh } = loadFundUx();

  assert.equal(isSnapshotFresh("2026-04-28T09:00:00.000Z", "2026-04-28T09:10:00.000Z", 30), true);
  assert.equal(isSnapshotFresh("2026-04-28T09:00:00.000Z", "2026-04-28T10:00:00.000Z", 30), false);
});

test("fund trade window explains cutoff and stale data", () => {
  const { getFundTradeWindow } = loadFundUx();

  assert.equal(getFundTradeWindow("2026-04-29T14:30:00+08:00", "2026-04-28T00:00:00.000Z").state, "before_cutoff");
  assert.equal(getFundTradeWindow("2026-04-29T15:30:00+08:00", "2026-04-28T00:00:00.000Z").state, "after_cutoff");
  assert.equal(getFundTradeWindow("2026-05-02T10:00:00+08:00", "2026-04-30T00:00:00.000Z").state, "closed");
  assert.equal(getFundTradeWindow("2026-04-29T14:30:00+08:00", "2026-04-24T00:00:00.000Z").dataFreshness, "stale");
});

test("position sizing caps buy amount by portfolio weight", () => {
  const { buildPositionSizing } = loadFundUx();

  const sizing = buildPositionSizing({
    currentPortfolioValue: 100000,
    currentHoldingValue: 20000,
    plannedAmount: 10000,
    maxPositionWeight: 25
  });

  assert.equal(Math.round(sizing.currentWeight * 100) / 100, 20);
  assert.equal(Math.round(sizing.afterPlannedWeight * 100) / 100, 27.27);
  assert.equal(Math.round(sizing.suggestedAmount), 6667);
  assert.equal(sizing.status, "trim_order");
});

test("trade action changes for unheld buy candidates and held sell reviews", () => {
  const { buildFundTradeAction } = loadFundUx();

  const buy = buildFundTradeAction({
    held: false,
    dataScore: 86,
    purchaseOpen: true,
    peerPercentile: 82,
    maxDrawdown: -8,
    highImpactAnnouncementCount: 0,
    positionStatus: "within_limit",
    tradeWindowState: "before_cutoff"
  });
  assert.equal(buy.intent, "buy");
  assert.equal(buy.action, "可分批买入");

  const sellReview = buildFundTradeAction({
    held: true,
    dataScore: 90,
    purchaseOpen: true,
    profitRate: -13,
    maxDrawdown: -24,
    maxDrawdownTolerance: 15,
    peerPercentile: 28,
    highImpactAnnouncementCount: 1,
    positionStatus: "within_limit",
    tradeWindowState: "before_cutoff"
  });
  assert.equal(sellReview.intent, "sell_review");
  assert.match(sellReview.action, /止损|减仓/);
});

test("sell review signals surface profit taking loss control and announcement risks", () => {
  const { buildSellReviewSignals } = loadFundUx();

  const review = buildSellReviewSignals({
    profitRate: 26,
    targetReturn: 18,
    maxDrawdown: -19,
    maxDrawdownTolerance: 15,
    peerPercentile: 32,
    holdingDays: 5,
    highImpactAnnouncementCount: 1,
    redemptionRate: 1.5
  });

  assert.deepEqual(review.signals.map((item) => item.key), ["take_profit", "stop_loss", "peer_deterioration", "announcement", "short_holding_fee"]);
  assert.equal(review.conclusion, "卖出/减仓复盘");
});

test("trading cost scenarios include redemption cost and short holding warnings", () => {
  const { buildTradingCostScenarios } = loadFundUx();

  const scenarios = buildTradingCostScenarios({
    feeSummary: {
      subscriptionRate: 0.1,
      serviceRate: 0.4,
      managementRate: null,
      custodyRate: null,
      redemptionRate: 1.5
    },
    amount: 10000,
    days: [7, 30, 180, 365]
  });

  assert.equal(scenarios.length, 4);
  assert.ok(scenarios[0].cost > 150);
  assert.equal(scenarios[0].warning, "短期赎回成本高");
});

test("daily trading desk prioritizes data blockers then actionable trades", () => {
  const { buildDailyTradingDesk } = loadFundUx();

  const desk = buildDailyTradingDesk({
    tradeWindow: { state: "before_cutoff", dataFreshness: "stale" },
    reviewItems: [{ title: "持仓回撤复盘", href: "/portfolio" }],
    buyItems: [{ title: "候选基金可分批买入", href: "/funds/000001" }],
    waitItems: [{ title: "三只基金暂不操作", href: "/funds/watchlist" }]
  });

  assert.deepEqual(desk.items.map((item) => item.kind), ["data", "buy", "review", "wait"]);
  assert.equal(desk.items[0].priority, "high");
});

test("trade confirmation checklist keeps post-order records complete", () => {
  const { buildTradeConfirmationChecklist } = loadFundUx();

  const pending = buildTradeConfirmationChecklist({
    applicationAmount: 10000,
    applicationDate: "2026-04-29",
    confirmationDate: "",
    confirmedNav: null,
    confirmedShares: null,
    fee: 10
  });
  assert.equal(pending.status, "pending_confirmation");
  assert.deepEqual(pending.missing, ["确认日期", "确认净值", "确认份额"]);

  const confirmed = buildTradeConfirmationChecklist({
    applicationAmount: 10000,
    applicationDate: "2026-04-29",
    confirmationDate: "2026-04-30",
    confirmedNav: 1.25,
    confirmedShares: 7992,
    fee: 10
  });
  assert.equal(confirmed.status, "confirmed");
});

test("redemption plan uses fee ladder and China market settlement calendar", () => {
  const { buildRedemptionPlan } = loadFundUx();

  const plan = buildRedemptionPlan({
    amount: 10000,
    holdingDays: 5,
    requestDate: "2026-04-30",
    feeRows: [
      { conditionName: "持有期限小于7日", feeValue: "1.50%" },
      { conditionName: "持有期限大于等于7日小于30日", feeValue: "0.50%" },
      { conditionName: "持有期限大于等于30日", feeValue: "0.00%" }
    ],
    settlementTradingDays: 1
  });

  assert.equal(plan.currentRate, 1.5);
  assert.equal(plan.currentFee, 150);
  assert.equal(plan.estimatedArrivalDate, "2026-05-06");
});

test("auto review plan creates buy follow-up dates and trigger rules", () => {
  const { buildAutoReviewPlan } = loadFundUx();

  const plan = buildAutoReviewPlan({
    baseDate: "2026-04-29",
    targetReturn: 12,
    maxDrawdownTolerance: 10,
    peerFloor: 40
  });

  assert.deepEqual(plan.items.map((item) => item.key), ["confirm", "week_review", "month_review", "drawdown_trigger", "peer_trigger", "target_return"]);
  assert.equal(plan.items[1].date, "2026-05-06");
});

test("alternative fund picker keeps same type and lower risk candidates", () => {
  const { chooseAlternativeFunds } = loadFundUx();

  const alternatives = chooseAlternativeFunds({
    currentCode: "000001",
    fundType: "混合型",
    candidates: [
      { code: "000001", name: "当前", fundType: "混合型", observationScore: 95, maxDrawdown: -5, year1Return: 20 },
      { code: "000002", name: "同类低回撤", fundType: "混合型", observationScore: 88, maxDrawdown: -8, year1Return: 18 },
      { code: "000003", name: "不同类", fundType: "债券型", observationScore: 92, maxDrawdown: -2, year1Return: 6 },
      { code: "000004", name: "同类高回撤", fundType: "混合型", observationScore: 90, maxDrawdown: -28, year1Return: 30 }
    ],
    maxAlternatives: 2
  });

  assert.deepEqual(alternatives.map((item) => item.code), ["000002", "000004"]);
});

test("money risk frame translates percent risk into RMB impact", () => {
  const { buildMoneyRiskFrame } = loadFundUx();

  const frame = buildMoneyRiskFrame({
    plannedAmount: 10000,
    currentValue: 20000,
    profit: -1200,
    maxDrawdown: -18,
    dailyRate: -3
  });

  assert.equal(frame.plannedDrawdownLoss, 1800);
  assert.equal(frame.currentProfitText, "当前亏损约 ¥1,200.00");
  assert.equal(frame.dailyMoveAmount, -600);
});

test("user alert rules evaluate daily move ranking position and announcement triggers", () => {
  const { evaluateUserAlertRule } = loadFundUx();

  assert.equal(evaluateUserAlertRule({ metric: "daily_drop", threshold: 3 }, { dailyRate: -3.2 })?.level, "high");
  assert.equal(evaluateUserAlertRule({ metric: "take_profit", threshold: 15 }, { profitRate: 18 })?.level, "medium");
  assert.equal(evaluateUserAlertRule({ metric: "peer_below", threshold: 40 }, { peerPercentile: 35 })?.level, "medium");
  assert.equal(evaluateUserAlertRule({ metric: "position_over", threshold: 25 }, { positionWeight: 31 })?.level, "high");
  assert.equal(evaluateUserAlertRule({ metric: "manager_change", threshold: null }, { highImpactAnnouncementCount: 1 })?.level, "high");
});

test("China market calendar handles 2026 exchange holidays", () => {
  const { isChinaMarketTradingDay, nextChinaMarketTradingDay } = loadFundUx();

  assert.equal(isChinaMarketTradingDay("2026-05-01"), false);
  assert.equal(isChinaMarketTradingDay("2026-05-06"), true);
  assert.equal(nextChinaMarketTradingDay("2026-04-30", 1), "2026-05-06");
});

test("mobile trade card keeps only the daily trading essentials", () => {
  const { buildMobileTradeCard } = loadFundUx();

  const card = buildMobileTradeCard({
    action: "可分批买入",
    suggestedAmount: 8000,
    tradeWindowLabel: "15:00 前可按今日申请",
    riskText: "买 1 万，样本最大回撤约亏 1800 元",
    primaryHref: "/funds/000001"
  });

  assert.deepEqual(card.items.map((item) => item.label), ["结论", "金额", "窗口", "风险"]);
  assert.equal(card.primaryAction, "查看交易参考");
});
test("transaction signatures identify duplicate manual and imported transactions", () => {
  const { buildTransactionSignature } = loadFundUx();

  const first = buildTransactionSignature({
    targetType: "fund",
    targetKey: "011815",
    transactionType: "buy",
    tradeDate: "2026-04-29T00:00:00.000Z",
    shares: 123.456789,
    price: 1.234567,
    amount: 152.41,
    fee: 0
  });
  const duplicate = buildTransactionSignature({
    targetType: "fund",
    targetKey: "011815",
    transactionType: "buy",
    tradeDate: "2026-04-29",
    shares: 123.4567891,
    price: 1.2345674,
    amount: 152.4101,
    fee: 0
  });

  assert.equal(first, duplicate);
  assert.notEqual(first, buildTransactionSignature({
    targetType: "fund",
    targetKey: "011815",
    transactionType: "sell",
    tradeDate: "2026-04-29",
    shares: 123.456789,
    price: 1.234567,
    amount: 152.41,
    fee: 0
  }));
});

test("holding reconciliation compares manual holdings with transaction-derived values", () => {
  const { buildHoldingReconciliation } = loadFundUx();

  const reconciliation = buildHoldingReconciliation({
    manualShares: 100,
    manualCostAmount: 1000,
    transactions: [
      { transactionType: "buy", shares: 80, amount: 800, fee: 2 },
      { transactionType: "buy", shares: 40, amount: 420, fee: 1 },
      { transactionType: "sell", shares: 20, amount: 220, fee: 1 },
      { transactionType: "dividend", shares: null, amount: 12, fee: null }
    ]
  });

  assert.equal(reconciliation.derivedShares, 100);
  assert.equal(reconciliation.derivedCostAmount, 1002);
  assert.equal(reconciliation.shareDifference, 0);
  assert.equal(reconciliation.costDifference, -2);
  assert.equal(reconciliation.status, "warn");
});

test("alert action normalization accepts persisted actions and rejects unsafe values", () => {
  const { normalizeAlertActionState } = loadFundUx();

  assert.deepEqual(normalizeAlertActionState({ action: "snooze", until: "2026-05-02" }), {
    action: "snooze",
    until: "2026-05-02"
  });
  assert.equal(normalizeAlertActionState({ action: "snooze", until: "bad-date" }), null);
  assert.equal(normalizeAlertActionState({ action: "unknown" }), null);
});

test("comparison insight summary surfaces winners and missing metrics", () => {
  const { summarizeComparisonInsights } = loadFundUx();

  const insights = summarizeComparisonInsights([
    { key: "a", name: "A", metrics: { return1y: 12, maxDrawdown: -8, feeKnown: true, feeCost365d: 80, dataScore: 90 } },
    { key: "b", name: "B", metrics: { return1y: 18, maxDrawdown: -22, feeKnown: true, feeCost365d: 60, dataScore: 70 } },
    { key: "c", name: "C", metrics: { return1y: null, maxDrawdown: null, feeKnown: false, feeCost365d: null, dataScore: 42 } }
  ]);

  assert.deepEqual(insights.map((item) => item.key), ["return", "risk", "fee", "data"]);
  assert.equal(insights[0].winnerKey, "b");
  assert.equal(insights[1].winnerKey, "a");
  assert.equal(insights[2].winnerKey, "b");
  assert.match(insights[3].detail, /C/);
});

test("stuck sync job detector marks old running jobs", () => {
  const { buildSyncJobState } = loadFundUx();

  const fresh = buildSyncJobState({
    status: "running",
    startedAt: "2026-04-30T11:00:00.000Z",
    now: "2026-04-30T12:00:00.000Z",
    stuckAfterHours: 3
  });
  const stuck = buildSyncJobState({
    status: "running",
    startedAt: "2026-04-30T06:00:00.000Z",
    now: "2026-04-30T12:00:00.000Z",
    stuckAfterHours: 3
  });

  assert.equal(fresh.state, "running");
  assert.equal(stuck.state, "stuck");
  assert.equal(stuck.ageHours, 6);
});

test("rebalance plan translates target drift into amount actions", () => {
  const { buildRebalancePlan } = loadFundUx();

  const plan = buildRebalancePlan({
    totalValue: 100000,
    targets: [
      { key: "fund", label: "基金", currentWeight: 70, targetWeight: 60, maxWeight: null },
      { key: "wealth", label: "理财", currentWeight: 20, targetWeight: 30, maxWeight: null },
      { key: "single", label: "单仓", currentWeight: 35, targetWeight: null, maxWeight: 30 }
    ],
    driftThresholdPercent: 5
  });

  assert.deepEqual(plan.items.map((item) => item.action), ["trim", "add", "over_limit"]);
  assert.equal(plan.items[0].amount, -10000);
  assert.equal(plan.items[1].amount, 10000);
  assert.equal(plan.summary.overLimitCount, 1);
});

test("cash ledger summary separates deposits spending and available balance", () => {
  const { buildCashLedgerSummary } = loadFundUx();

  const summary = buildCashLedgerSummary([
    { transactionType: "deposit", amount: 10000 },
    { transactionType: "buy", amount: 3000 },
    { transactionType: "dividend", amount: 120 },
    { transactionType: "fee", amount: 10 }
  ]);

  assert.equal(summary.inflow, 10120);
  assert.equal(summary.outflow, 3010);
  assert.equal(summary.balance, 7110);
});

test("advanced alert rules evaluate consecutive drops peer lag and drawdown highs", () => {
  const { evaluateAdvancedAlertRule } = loadFundUx();

  assert.equal(evaluateAdvancedAlertRule({ metric: "consecutive_drop", threshold: 3 }, { recentDailyRates: [-1, -2, -0.5] })?.level, "high");
  assert.equal(evaluateAdvancedAlertRule({ metric: "peer_lag", threshold: 8 }, { returnValue: 4, peerMedianReturn: 14 })?.level, "medium");
  assert.equal(evaluateAdvancedAlertRule({ metric: "drawdown_new_high", threshold: 15 }, { maxDrawdown: -18, previousMaxDrawdown: -12 })?.level, "high");
});

test("data source health groups recent sync failures by source", () => {
  const { summarizeDataSourceHealth } = loadFundUx();

  const health = summarizeDataSourceHealth([
    { jobType: "daily_collect", status: "success", startedAt: "2026-04-30T10:00:00Z", finishedAt: "2026-04-30T10:05:00Z", failedSources: null, message: "akshare ok" },
    { jobType: "daily_collect", status: "partial", startedAt: "2026-04-29T10:00:00Z", finishedAt: "2026-04-29T10:05:00Z", failedSources: "akshare,chinawealth", message: "akshare failed: timeout; chinawealth failed: denied" }
  ]);

  assert.equal(health.find((item) => item.source === "akshare")?.failedCount, 1);
  assert.equal(health.find((item) => item.source === "chinawealth")?.status, "bad");
});

test("snapshot freshness helper returns stale and fresh states", () => {
  const { buildDashboardSnapshotState } = loadFundUx();

  assert.equal(buildDashboardSnapshotState("2026-04-30T11:50:00Z", "2026-04-30T12:00:00Z", 30).state, "fresh");
  assert.equal(buildDashboardSnapshotState("2026-04-30T10:00:00Z", "2026-04-30T12:00:00Z", 30).state, "stale");
  assert.equal(buildDashboardSnapshotState(null, "2026-04-30T12:00:00Z", 30).state, "missing");
});

test("decision review state classifies due and overdue records", () => {
  const { buildDecisionReviewState } = loadFundUx();

  assert.equal(buildDecisionReviewState({ reviewDate: "2026-04-29", status: "open" }, "2026-04-30").state, "overdue");
  assert.equal(buildDecisionReviewState({ reviewDate: "2026-04-30", status: "open" }, "2026-04-30").state, "due");
  assert.equal(buildDecisionReviewState({ reviewDate: "2026-05-02", status: "closed" }, "2026-04-30").state, "closed");
});
