import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { MetricCard } from "@/components/MetricCard";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getAlertCenter, getPortfolioDashboard, getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [summary, portfolio, alerts] = await Promise.all([getSummary(), getPortfolioDashboard(), getAlertCenter()]);
  const hasData = summary.fundCount > 0 || summary.wealthCount > 0;
  const urgentAlerts = alerts.items.slice(0, 3);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <p className="text-sm font-medium text-steel">每日 22:30 更新</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">基金涨跌与银行理财净值</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            本地采集公开数据，集中查看基金日增长率、银行理财净值变化、关注清单和最近一次采集状态。
          </p>
        </div>
        <img
          src="https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=720&q=70"
          alt="财务数据桌面"
          className="h-44 w-full rounded-md object-cover shadow-panel"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="基金产品" value={summary.fundCount} helper="来自 AKShare 封装数据" />
        <MetricCard label="理财产品" value={summary.wealthCount} helper="来自公开披露页面" />
        <MetricCard
          label="理财净值记录"
          value={summary.wealthUpdatedCount}
          helper="可计算涨跌的产品优先展示"
        />
        <MetricCard
          label="最近采集"
          value={summary.latestSync?.status ?? "未运行"}
          helper={summary.latestSync ? formatDateTime(summary.latestSync.finishedAt) : "运行 npm run collect:seed 可载入演示数据"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">今日需要关注</h2>
            <Link href="/alerts" className="focus-ring rounded text-sm text-steel">
              全部提醒
            </Link>
          </div>
          <div className="mt-4 divide-y divide-line">
            {urgentAlerts.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">暂无高优先级提醒。</p>
            ) : (
              urgentAlerts.map((item) => (
                <Link
                  href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                  className="focus-ring block rounded py-3 text-sm"
                  key={`${item.metric}-${item.targetKey}`}
                >
                  <span className="block font-medium text-ink">{item.title}</span>
                  <span className="mt-1 block text-slate-600">{item.message}</span>
                </Link>
              ))
            )}
          </div>
        </div>
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">持仓概览</h2>
            <Link href="/portfolio" className="focus-ring rounded text-sm text-steel">
              持仓工作台
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricCard label="当前市值" value={`¥${formatNumber(portfolio.summary.currentValue, 2)}`} helper="按最新净值估算" />
            <MetricCard label="累计盈亏" value={`¥${formatNumber(portfolio.summary.profit, 2)}`} helper={`${formatNumber(portfolio.summary.profitRate, 2)}%`} />
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
            <DistributionBar
              label="上涨"
              value={summary.fundDistribution.positive}
              total={summary.fundCount}
              color="bg-coral"
            />
            <DistributionBar
              label="下跌"
              value={summary.fundDistribution.negative}
              total={summary.fundCount}
              color="bg-mint"
            />
            <DistributionBar
              label="平盘"
              value={summary.fundDistribution.flat}
              total={summary.fundCount}
              color="bg-steel"
            />
          </div>
        </div>

        <RankingPanel title="上涨榜" rows={summary.topGainers} />
        <RankingPanel title="下跌榜" rows={summary.topLosers} />
      </section>
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
          全部基金
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
