import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NavChart } from "@/components/NavChart";
import { TrendBadge } from "@/components/TrendBadge";
import { WatchButton } from "@/components/WatchButton";
import { formatDate, formatNumber } from "@/lib/format";
import { getWealthProductDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ registerCode: string }>;
};

export default async function WealthDetailPage({ params }: PageProps) {
  const { registerCode } = await params;
  const product = await getWealthProductDetail(decodeURIComponent(registerCode));

  if (!product) {
    notFound();
  }

  const latest = product.navs.at(-1);
  const chartData = product.navs.map((nav) => ({
    date: formatDate(nav.navDate),
    value: nav.netValue,
    changeRate: nav.dailyChangeRate
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{product.registerCode}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{product.name}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {product.issuer ?? "未知机构"} · {product.riskLevel ?? "风险未披露"} · {product.operationMode ?? "模式未披露"}
          </p>
        </div>
        <WatchButton targetType="wealth" code={product.registerCode} initialWatched={product.watched} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="最新净值" value={formatNumber(latest?.netValue)} />
        <Info label="累计净值" value={formatNumber(latest?.accumulatedValue)} />
        <Info label="净值变化" value={<TrendBadge value={latest?.dailyChangeRate} />} />
        <Info label="净值日" value={formatDate(latest?.navDate)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {product.periodReturns.map((item) => (
          <Info label={item.label} value={<TrendBadge value={item.value} />} key={item.label} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">购买与流动性</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="风险等级" value={product.riskLevel} />
            <Field label="运作模式" value={product.operationMode} />
            <Field label="起购金额" value={formatNumber(product.minPurchaseAmount, 2)} />
            <Field label="业绩比较基准" value={product.performanceBenchmark} />
            <Field label="投资期限" value={product.investmentTerm} />
            <Field label="开放日" value={formatDate(product.openDate)} />
            <Field label="下一开放日" value={formatDate(product.nextOpenDate)} />
            <Field label="赎回到账" value={product.redeemArrival} />
            <Field label="管理人" value={product.managerName ?? product.issuer} />
            <Field label="托管人" value={product.custodianName} />
            <Field label="费率说明" value={product.feeSummary} />
            <Field label="资产配置" value={product.assetAllocation} />
          </div>
        </div>
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">风险提醒</h2>
          <div className="mt-3 space-y-3">
            {product.warnings.length === 0 ? (
              <p className="text-sm text-slate-500">暂无触发的理财风险提醒。</p>
            ) : (
              product.warnings.map((item) => (
                <div className="rounded-md border border-line bg-paper p-3 text-sm" key={`${item.metric}-${item.title}`}>
                  <div className="font-medium text-ink">{item.title}</div>
                  <div className="mt-1 text-slate-600">{item.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">净值曲线</h2>
        <NavChart data={chartData} valueLabel="净值" />
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
                <th className="px-4 py-3 text-right font-medium">变化值</th>
                <th className="px-4 py-3 text-right font-medium">变化率</th>
                <th className="px-4 py-3 font-medium">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...product.navs].reverse().slice(0, 30).map((nav) => (
                <tr key={nav.id}>
                  <td className="px-4 py-3">{formatDate(nav.navDate)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.netValue)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.accumulatedValue)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.dailyChange)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={nav.dailyChangeRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nav.changeSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <h2 className="font-semibold text-ink">公告与披露</h2>
        <div className="mt-3 divide-y divide-line">
          {product.announcements.length === 0 && !product.sourceUrl ? (
            <p className="py-4 text-sm text-slate-500">暂无公告</p>
          ) : null}
          {product.sourceUrl ? (
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring block rounded py-3 text-sm"
            >
              <span className="block font-medium text-ink">中国理财网产品披露页</span>
              <span className="mt-1 block text-slate-500">chinawealth · {formatDate(product.latestDisclosureAt)}</span>
            </a>
          ) : null}
          {product.announcements.map((item) => (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring block rounded py-3 text-sm"
              key={item.id}
            >
              <span className="block font-medium text-ink">{item.title}</span>
              <span className="mt-1 block text-slate-500">
                {item.source} · {formatDate(item.publishedAt)}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600 shadow-panel">
        <h2 className="font-semibold text-ink">口径说明</h2>
        <p className="mt-2">
          银行理财没有统一实时涨跌行情。这里优先展示公开披露净值和净值变化；阶段变化用本地已采集净值首尾计算，缺少历史净值时显示为空。
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
