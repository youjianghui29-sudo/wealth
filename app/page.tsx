import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { MetricCard } from "@/components/MetricCard";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getAlertCenter, getDataCoverage, getPortfolioDashboard, getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [summary, portfolio, alerts, coverage] = await Promise.all([
    getSummary(),
    getPortfolioDashboard(),
    getAlertCenter(),
    getDataCoverage()
  ]);
  const hasData = summary.fundCount > 0 || summary.wealthCount > 0;
  const fundNavMetric = coverage.metrics.find((item) => item.key === "fund_nav_latest");
  const wealthNavMetric = coverage.metrics.find((item) => item.key === "wealth_nav");
  const historyMetric = coverage.metrics.find((item) => item.key === "fund_history_14");
  const urgentAlerts = alerts.items.slice(0, 3);
  const actionItems = [
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
    ...urgentAlerts.map((item) => ({
      title: item.title,
      message: item.message,
      href: item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`
    }))
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
            <DataLine label="基金净值" value={`${formatDate(fundNavMetric?.latestDate)} · ${(fundNavMetric?.value ?? 0).toLocaleString("zh-CN")} 条`} />
            <DataLine label="理财披露" value={`${formatDate(wealthNavMetric?.latestDate)} · ${(wealthNavMetric?.value ?? 0).toLocaleString("zh-CN")} 条`} />
            <DataLine label="14日历史" value={`${historyMetric?.ratio ? historyMetric.ratio.toFixed(1) : "--"}% 覆盖`} />
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
