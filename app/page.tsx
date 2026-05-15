import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { InvestmentPreferencesPanel } from "@/components/InvestmentPreferencesPanel";
import { MetricCard } from "@/components/MetricCard";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { applyAlertActionState, buildDailyTradingDesk, getFundTradeWindow } from "@/lib/fund-ux";
import { getAlertActionStates, getAlertCenter, getPortfolioDashboard, getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [summary, portfolio, alertCenter, alertStates] = await Promise.all([
    getSummary(),
    getPortfolioDashboard(),
    getAlertCenter(),
    getAlertActionStates()
  ]);
  const activeAlerts = applyAlertActionState(
    alertCenter.items.map((item) => ({
      ...item,
      id: `${item.metric}:${item.targetType}:${item.targetKey}:${item.title}`
    })),
    alertStates
  ).slice(0, 3);
  const hasData = summary.fundCount > 0 || summary.wealthCount > 0;
  const tradeWindow = getFundTradeWindow(new Date().toISOString(), summary.fundLatestNavDate);
  const tradingDesk = buildDailyTradingDesk({
    tradeWindow,
    buyItems: summary.dailyHighlights
      .filter((item) => item.href?.includes("/funds/candidates") || item.href?.includes("/funds/"))
      .slice(0, 2)
      .map((item) => ({ title: item.title, detail: item.detail, href: item.href ?? "/funds" })),
    reviewItems: portfolio.items
      .filter((item) => item.sellCheck?.level === "high" || item.dailyRate !== null && item.dailyRate <= -3)
      .slice(0, 3)
      .map((item) => ({
        title: `${item.name} 需要复盘`,
        detail: item.sellCheck?.summary ?? "持仓触发短期波动或回撤复盘。",
        href: item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`
      })),
    waitItems: portfolio.concentration.warnings.slice(0, 2).map((message) => ({ title: "组合集中度提醒", detail: message, href: "/portfolio" }))
  });
  const actionItems = [
    ...activeAlerts.map((item) => ({
      title: item.title,
      message: item.message,
      href: item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`
    })),
    ...summary.dailyHighlights.map((item) => ({
      title: item.title,
      message: item.detail,
      href: item.href ?? "/funds"
    })),
    ...(portfolio.summary.holdingCount === 0
      ? [{ title: "先录入持仓", message: "录入基金或理财后，首页会显示真实资产、今日盈亏和集中度。", href: "/portfolio" }]
      : []),
    ...(portfolio.summary.holdingCount > 0 && portfolio.summary.transactionCount === 0
      ? [{ title: "补交易流水", message: "没有买入、卖出、分红流水时，盈亏只能按手工成本估算。", href: "/portfolio" }]
      : []),
    ...portfolio.concentration.warnings.map((message) => ({ title: "组合集中度提醒", message, href: "/portfolio" })),
    ...(summary.latestSync?.status && summary.latestSync.status !== "success"
      ? [{ title: "采集不是完全成功", message: `最近任务状态为 ${summary.latestSync.status}，请查看失败源。`, href: "/sync" }]
      : []),
  ].slice(0, 6);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <p className="text-sm font-medium text-steel">今日待处理事项</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">先看自己的资产，再看市场机会</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            首页按购买者的日常流程组织：待处理事项、我的资产、数据状态和市场异动。需要深入研究时再进入基金、理财和数据页面。
          </p>
        </div>
        <img
          src="https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=720&q=70"
          alt="财务数据桌面"
          className="h-44 w-full rounded-md object-cover shadow-panel"
        />
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">每日交易台</h2>
            <p className="mt-1 text-sm text-slate-600">{tradeWindow.label}。{tradeWindow.detail}</p>
          </div>
          <Link href="/funds/watchlist" className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-sm text-steel">
            关注工作台
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {tradingDesk.items.length === 0 ? (
            <p className="text-sm text-slate-500">暂无需要今天处理的交易动作。</p>
          ) : (
            tradingDesk.items.map((item) => (
              <Link key={`${item.kind}-${item.title}`} href={item.href} className="focus-ring rounded-md border border-line bg-paper p-3 text-sm">
                <span
                  className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
                    item.priority === "high" ? "bg-coral/10 text-coral" : item.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-mint/10 text-mint"
                  }`}
                >
                  {item.kind === "data" ? "先看数据" : item.kind === "buy" ? "可处理买入" : item.kind === "review" ? "持仓复盘" : "暂不操作"}
                </span>
                <span className="mt-2 block font-medium text-ink">{item.title}</span>
                <span className="mt-1 block leading-5 text-slate-600">{item.detail}</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">今日待处理</h2>
          <Link href="/alerts" className="focus-ring rounded text-sm text-steel">
            提醒中心
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actionItems.length === 0 ? (
            <p className="text-sm text-slate-500">暂无必须处理的事项。</p>
          ) : (
            actionItems.map((item) => (
              <Link key={`${item.title}-${item.message}`} href={item.href} className="focus-ring rounded-md border border-line bg-paper p-3 text-sm">
                <span className="block font-medium text-ink">{item.title}</span>
                <span className="mt-1 block text-slate-600">{item.message}</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="当前市值" value={`¥${formatNumber(portfolio.summary.currentValue, 2)}`} helper={`${portfolio.summary.holdingCount} 个持仓标的`} />
        <MetricCard label="今日盈亏" value={`¥${formatNumber(portfolio.summary.dailyProfit, 2)}`} helper="按相邻净值估算" />
        <MetricCard label="累计盈亏" value={`¥${formatNumber(portfolio.summary.profit, 2)}`} helper={`${formatNumber(portfolio.summary.profitRate, 2)}%`} />
        <MetricCard
          label="现金流记录"
          value={portfolio.summary.transactionCount}
          helper={`手续费 ¥${formatNumber(portfolio.summary.feeAmount, 2)}`}
        />
      </section>

      <InvestmentPreferencesPanel />

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">我的资产</h2>
            <Link href="/portfolio" className="focus-ring rounded text-sm text-steel">
              持仓工作台
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricCard label="净投入成本" value={`¥${formatNumber(portfolio.summary.costAmount, 2)}`} helper="流水优先计算" />
            <MetricCard label="最大单仓" value={`${formatNumber(portfolio.concentration.topPositions[0]?.positionWeight, 1)}%`} helper={portfolio.concentration.topPositions[0]?.name ?? "暂无持仓"} />
            <MetricCard label="基金市值" value={`¥${formatNumber(portfolio.summary.fundMarketValue, 2)}`} helper="基金持仓估算市值" />
            <MetricCard label="理财市值" value={`¥${formatNumber(portfolio.summary.wealthMarketValue, 2)}`} helper="理财持仓估算市值" />
          </div>
        </div>

        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">数据状态</h2>
            <Link href="/sync" className="focus-ring rounded text-sm text-steel">
              采集详情
            </Link>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <DataLine label="基金净值" value={`${formatDate(summary.fundLatestNavDate)} · ${summary.fundLatestNavRows.toLocaleString("zh-CN")} 条`} />
            <DataLine label="理财披露" value={`${formatDate(summary.wealthLatestNavDate)} · ${summary.wealthUpdatedCount.toLocaleString("zh-CN")} 条`} />
            <DataLine label="基金总数" value={`${summary.fundCount.toLocaleString("zh-CN")} 只`} />
            <DataLine
              label="最近采集"
              value={summary.latestSync ? `${summary.latestSync.status} · ${formatDateTime(summary.latestSync.finishedAt)}` : "未运行"}
            />
          </div>
        </div>
      </section>

      {!hasData ? (
        <EmptyState
          title="当前数据库还没有数据"
          description="先运行 npm install、npm run db:push，然后运行 npm run collect:seed 查看演示效果；安装 Python 依赖后运行 npm run collect 获取真实数据。"
        />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">基金涨跌分布</h2>
          <div className="mt-4 grid gap-3">
            <DistributionBar label="上涨" value={summary.fundDistribution.positive} total={summary.fundCount} color="bg-coral" />
            <DistributionBar label="下跌" value={summary.fundDistribution.negative} total={summary.fundCount} color="bg-mint" />
            <DistributionBar label="平盘" value={summary.fundDistribution.flat} total={summary.fundCount} color="bg-steel" />
          </div>
        </div>

        <RankingPanel title="上涨榜" rows={summary.topGainers} />
        <RankingPanel title="下跌榜" rows={summary.topLosers} />
      </section>
    </div>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

function DistributionBar({
  label,
  value,
  total,
  color
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="text-slate-500">
          {value} / {total}
        </span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-md bg-paper">
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RankingPanel({
  title,
  rows
}: {
  title: string;
  rows: Awaited<ReturnType<typeof getSummary>>["topGainers"];
}) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <Link href="/funds" className="focus-ring rounded text-sm text-steel">
          候选池
        </Link>
      </div>
      <div className="mt-4 divide-y divide-line">
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">暂无数据</p>
        ) : (
          rows.map((row) => (
            <Link
              href={`/funds/${encodeURIComponent(row.code)}`}
              key={row.code}
              className="focus-ring flex items-center justify-between gap-3 rounded py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                <span className="block text-xs text-slate-500">
                  {row.code} · {formatDate(row.tradeDate)} · 净值 {formatNumber(row.unitNav)}
                </span>
              </span>
              <TrendBadge value={row.dailyGrowthRate} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
