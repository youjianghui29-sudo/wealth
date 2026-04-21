import Link from "next/link";
import { DeleteHoldingButton, DeleteTransactionButton, HoldingForm, TransactionForm, TransactionImportForm } from "@/components/HoldingForm";
import { MetricCard } from "@/components/MetricCard";
import { PortfolioTargetForm } from "@/components/PortfolioTargetForm";
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
        <h1 className="text-2xl font-semibold text-ink">真实盈亏中心</h1>
        <p className="mt-2 text-sm text-slate-600">按录入成本、份额和最新净值估算当前市值、今日盈亏、持有收益、赎回费和组合集中度。</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="净投入成本" value={`¥${formatNumber(dashboard.summary.costAmount, 2)}`} helper="流水优先，旧持仓用手工成本" />
        <MetricCard label="当前市值" value={`¥${formatNumber(dashboard.summary.currentValue, 2)}`} helper="按最新净值估算" />
        <MetricCard label="累计盈亏" value={`¥${formatNumber(dashboard.summary.profit, 2)}`} helper={`${formatNumber(dashboard.summary.profitRate, 2)}%`} />
        <MetricCard label="今日盈亏" value={`¥${formatNumber(dashboard.summary.dailyProfit, 2)}`} helper="按相邻净值估算" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="持仓数量" value={dashboard.summary.holdingCount} helper="基金和理财合计" />
        <MetricCard label="已实现收益" value={`¥${formatNumber(dashboard.summary.realizedProfit, 2)}`} helper={`回款 ¥${formatNumber(dashboard.summary.realizedIncome, 2)}`} />
        <MetricCard label="未实现盈亏" value={`¥${formatNumber(dashboard.summary.unrealizedProfit, 2)}`} helper="当前持仓浮盈浮亏" />
        <MetricCard label="手续费" value={`¥${formatNumber(dashboard.summary.feeAmount, 2)}`} helper={`${dashboard.summary.transactionCount} 条交易流水`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="基金市值" value={`¥${formatNumber(dashboard.summary.fundMarketValue, 2)}`} helper="基金持仓估算市值" />
        <MetricCard label="理财市值" value={`¥${formatNumber(dashboard.summary.wealthMarketValue, 2)}`} helper="理财持仓估算市值" />
        <MetricCard label="现金分红" value={`¥${formatNumber(dashboard.summary.dividendIncome, 2)}`} helper="已实现收益组成" />
        <MetricCard
          label="最大单仓"
          value={`${formatNumber(dashboard.concentration.topPositions[0]?.positionWeight, 1)}%`}
          helper={dashboard.concentration.topPositions[0]?.name ?? "暂无持仓"}
        />
      </section>

      <PortfolioTargetForm targets={dashboard.targetPlan} />

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">组合集中度</h2>
          <div className="mt-4 space-y-3">
            {dashboard.concentration.topPositions.length === 0 ? (
              <p className="text-sm text-slate-500">暂无可计算仓位的持仓。</p>
            ) : (
              dashboard.concentration.topPositions.map((item) => (
                <div key={item.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{item.name}</span>
                    <span className="shrink-0 text-slate-500">{formatNumber(item.positionWeight, 1)}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-md bg-paper">
                    <div className="h-full rounded-md bg-steel" style={{ width: `${Math.min(100, Math.max(0, item.positionWeight ?? 0))}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
          {dashboard.concentration.warnings.length ? (
            <div className="mt-4 space-y-2">
              {dashboard.concentration.warnings.map((warning) => (
                <div key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">穿透重仓与行业</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ExposureList title="重仓股暴露" rows={dashboard.concentration.topStocks} nameKey="stockName" />
            <ExposureList title="行业暴露" rows={dashboard.concentration.topIndustries} nameKey="industryName" />
          </div>
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink">多基金共同持有</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {dashboard.concentration.overlappingStocks.length === 0 ? (
                <p className="text-sm text-slate-500">暂无可识别的重仓股重合。</p>
              ) : (
                dashboard.concentration.overlappingStocks.slice(0, 4).map((row) => (
                  <div key={row.stockCode || row.stockName} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                    <div className="font-medium text-ink">{row.stockName}</div>
                    <div className="mt-1 text-slate-600">
                      {row.fundCount} 只基金共同持有 · 组合暴露 {formatNumber(row.exposure, 2)}%
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold text-ink">卖出/赎回检查</h2>
        <p className="mt-1 text-sm text-slate-600">赎回前先核对费用、持有天数、短期波动、仓位和流水完整度。</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {dashboard.items.length === 0 ? (
            <p className="text-sm text-slate-500">暂无持仓，录入后会生成赎回检查卡。</p>
          ) : (
            dashboard.items.slice(0, 6).map((item) => (
              <div key={`sell-${item.id}`} className="rounded-md border border-line bg-paper p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                      className="focus-ring rounded font-medium text-ink"
                    >
                      {item.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">{item.sellCheck.summary}</div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${sellLevelClass(item.sellCheck.level)}`}>
                    {sellLevelLabel(item.sellCheck.level)}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {item.sellCheck.checks.map((check) => (
                    <div key={`${item.id}-${check.label}`} className={`rounded-md border px-3 py-2 ${checkStatusClass(check.status)}`}>
                      <div className="font-medium">{check.label}</div>
                      <div className="mt-1 text-xs">{check.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <HoldingForm
        defaultTargetType={targetType}
        defaultTargetKey={single(rawParams.targetKey)}
        defaultCostPrice={single(rawParams.costPrice)}
      />

      <TransactionForm
        defaultTargetType={targetType}
        defaultTargetKey={single(rawParams.targetKey)}
        defaultPrice={single(rawParams.costPrice)}
      />

      <TransactionImportForm />

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {dashboard.items.length} 个持仓标的</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">标的</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">成本</th>
                <th className="px-4 py-3 text-right font-medium">份额</th>
                <th className="px-4 py-3 text-right font-medium">仓位</th>
                <th className="px-4 py-3 text-right font-medium">最新价</th>
                <th className="px-4 py-3 text-right font-medium">当前市值</th>
                <th className="px-4 py-3 text-right font-medium">今日盈亏</th>
                <th className="px-4 py-3 text-right font-medium">累计盈亏</th>
                <th className="px-4 py-3 text-right font-medium">已实现/未实现</th>
                <th className="px-4 py-3 text-right font-medium">赎回费估算</th>
                <th className="px-4 py-3 text-right font-medium">流水</th>
                <th className="px-4 py-3 text-right font-medium">持有天数</th>
                <th className="px-4 py-3 font-medium">净值日</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dashboard.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={15}>
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
                    <td className="px-4 py-3 text-right">{formatNumber(item.shares, 2)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.positionWeight, 1)}%</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.latestPrice, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.currentValue, 2)}</td>
                    <td className="px-4 py-3 text-right">
                      {formatNumber(item.dailyProfit, 2)}
                      <div className="mt-1 text-xs">
                        <TrendBadge value={item.dailyRate} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.profitRate} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      <div>{formatNumber(item.realizedProfit, 2)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatNumber(item.unrealizedProfit, 2)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.estimatedRedemptionFee === null ? "--" : `¥${formatNumber(item.estimatedRedemptionFee, 2)}`}
                      {item.redemptionRate !== null ? <div className="mt-1 text-xs text-slate-500">{formatNumber(item.redemptionRate, 2)}%</div> : null}
                    </td>
                    <td className="px-4 py-3 text-right">{item.transactionCount}</td>
                    <td className="px-4 py-3 text-right">{item.holdingDays ?? "--"}</td>
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

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">最近交易流水</h2>
          <p className="mt-1 text-sm text-slate-600">流水是成本、分红、手续费和真实盈亏的优先口径。</p>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 font-medium">标的</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">份额</th>
                <th className="px-4 py-3 text-right font-medium">成交净值</th>
                <th className="px-4 py-3 text-right font-medium">金额</th>
                <th className="px-4 py-3 text-right font-medium">手续费</th>
                <th className="px-4 py-3 font-medium">备注</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dashboard.transactions.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={9}>
                    暂无交易流水。录入流水后，持仓盈亏会优先按真实现金流计算。
                  </td>
                </tr>
              ) : (
                dashboard.transactions.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.tradeDate)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                        className="focus-ring rounded font-medium text-ink"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.targetKey}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{transactionTypeLabel(item.transactionType)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.shares, 2)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.price, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.amount, 2)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.fee, 2)}</td>
                    <td className="px-4 py-3 text-slate-600">{item.note ?? "--"}</td>
                    <td className="px-4 py-3">
                      <DeleteTransactionButton id={item.id} />
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

function transactionTypeLabel(value: string) {
  if (value === "buy") {
    return "买入";
  }
  if (value === "sell") {
    return "卖出";
  }
  if (value === "dividend") {
    return "分红";
  }
  if (value === "fee") {
    return "手续费";
  }
  return value;
}

function sellLevelLabel(value: string) {
  if (value === "high") {
    return "重点核对";
  }
  if (value === "medium") {
    return "需补信息";
  }
  return "基础完整";
}

function sellLevelClass(value: string) {
  if (value === "high") {
    return "bg-coral/10 text-coral";
  }
  if (value === "medium") {
    return "bg-steel/10 text-steel";
  }
  return "bg-mint/10 text-mint";
}

function checkStatusClass(value: string) {
  if (value === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (value === "missing") {
    return "border-slate-200 bg-white text-slate-600";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function ExposureList({
  title,
  rows,
  nameKey
}: {
  title: string;
  rows: Array<{ exposure: number; fundCount: number; stockName?: string; industryName?: string }>;
  nameKey: "stockName" | "industryName";
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">暂无可计算数据。</p>
        ) : (
          rows.slice(0, 5).map((row) => (
            <div key={`${row[nameKey]}-${row.exposure}`} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-ink">{row[nameKey] ?? "--"}</span>
                <span className="shrink-0 text-slate-600">{formatNumber(row.exposure, 2)}%</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">来自 {row.fundCount} 只基金</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
