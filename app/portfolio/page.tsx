import Link from "next/link";
import { DeleteHoldingButton, HoldingForm } from "@/components/HoldingForm";
import { MetricCard } from "@/components/MetricCard";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getPortfolioDashboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortfolioPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const targetType = single(rawParams.targetType) === "wealth" ? "wealth" : "fund";
  const dashboard = await getPortfolioDashboard();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">持仓工作台</h1>
        <p className="mt-2 text-sm text-slate-600">把已买入或重点关注的基金、银行理财放在一起看收益、净值日期和风险变化。</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="投入成本" value={`¥${formatNumber(dashboard.summary.costAmount, 2)}`} helper="手工录入成本金额汇总" />
        <MetricCard label="当前市值" value={`¥${formatNumber(dashboard.summary.currentValue, 2)}`} helper="按最新净值估算" />
        <MetricCard label="累计盈亏" value={`¥${formatNumber(dashboard.summary.profit, 2)}`} helper={`${formatNumber(dashboard.summary.profitRate, 2)}%`} />
        <MetricCard label="今日盈亏" value={`¥${formatNumber(dashboard.summary.dailyProfit, 2)}`} helper="按相邻净值估算" />
      </section>

      <HoldingForm
        defaultTargetType={targetType}
        defaultTargetKey={single(rawParams.targetKey)}
        defaultCostPrice={single(rawParams.costPrice)}
      />

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {dashboard.items.length} 个持仓标的</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">标的</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">成本</th>
                <th className="px-4 py-3 text-right font-medium">最新价</th>
                <th className="px-4 py-3 text-right font-medium">当前市值</th>
                <th className="px-4 py-3 text-right font-medium">今日盈亏</th>
                <th className="px-4 py-3 text-right font-medium">累计盈亏</th>
                <th className="px-4 py-3 font-medium">净值日</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dashboard.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={9}>
                    暂无持仓。先录入一个基金代码或理财登记编码。
                  </td>
                </tr>
              ) : (
                dashboard.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                        className="focus-ring rounded font-medium text-ink"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.targetKey}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.targetType === "fund" ? "基金" : "理财"}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.costAmount, 2)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.latestPrice, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.currentValue, 2)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.dailyProfit, 2)}</td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.profitRate} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.priceDate)}</td>
                    <td className="px-4 py-3">
                      <DeleteHoldingButton id={item.id} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
