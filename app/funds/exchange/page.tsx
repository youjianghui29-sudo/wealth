import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getExchangeFunds } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExchangeFundsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = { q: single(raw.q), exchangeType: single(raw.exchangeType), page: single(raw.page) };
  const result = await getExchangeFunds(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">场内基金</h1>
        <p className="mt-2 text-sm text-slate-600">展示 ETF / LOF 最新价、涨跌幅、折价率和成交额。</p>
      </div>
      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_160px_100px]">
        <input name="q" defaultValue={params.q} placeholder="搜索代码或名称" className="focus-ring rounded-md border border-line px-3 py-2" />
        <select name="exchangeType" defaultValue={params.exchangeType ?? ""} className="focus-ring rounded-md border border-line px-3 py-2">
          <option value="">全部</option>
          <option value="ETF">ETF</option>
          <option value="LOF">LOF</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">筛选</button>
      </form>
      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 只场内基金</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">最新价</th>
                <th className="px-4 py-3 text-right font-medium">涨跌幅</th>
                <th className="px-4 py-3 text-right font-medium">折价率</th>
                <th className="px-4 py-3 text-right font-medium">成交额</th>
                <th className="px-4 py-3 font-medium">日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={`${row.exchangeType}-${row.fundCode}`}>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${encodeURIComponent(row.fundCode)}`} className="focus-ring rounded font-medium text-ink">{row.fundName}</Link>
                    <div className="mt-1 text-xs text-slate-500">{row.fundCode}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.exchangeType}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.latestPrice)}</td>
                  <td className="px-4 py-3 text-right"><TrendBadge value={row.changeRate} /></td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.discountRate, 2)}%</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.amount, 0)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.tradeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={result.page} pageCount={result.pageCount} searchParams={{ q: params.q, exchangeType: params.exchangeType }} />
    </div>
  );
}
