import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getMoneyFunds } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MoneyFundsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = { q: single(raw.q), sort: single(raw.sort), page: single(raw.page) };
  const result = await getMoneyFunds(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">货币基金</h1>
        <p className="mt-2 text-sm text-slate-600">展示万份收益、7 日年化和可购状态。</p>
      </div>
      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_180px_100px]">
        <input name="q" defaultValue={params.q} placeholder="搜索代码或名称" className="focus-ring rounded-md border border-line px-3 py-2" />
        <select name="sort" defaultValue={params.sort ?? "annualized"} className="focus-ring rounded-md border border-line px-3 py-2">
          <option value="annualized">7 日年化排序</option>
          <option value="income">万份收益排序</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">筛选</button>
      </form>
      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 只货币基金</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 text-right font-medium">万份收益</th>
                <th className="px-4 py-3 text-right font-medium">7 日年化</th>
                <th className="px-4 py-3 text-right font-medium">日涨幅</th>
                <th className="px-4 py-3 font-medium">基金经理</th>
                <th className="px-4 py-3 font-medium">日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={row.fundCode}>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${encodeURIComponent(row.fundCode)}`} className="focus-ring rounded font-medium text-ink">{row.fundName}</Link>
                    <div className="mt-1 text-xs text-slate-500">{row.fundCode}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.tenThousandIncome, 4)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.sevenDayAnnualized, 3)}%</td>
                  <td className="px-4 py-3 text-right"><TrendBadge value={row.dailyGrowthRate} /></td>
                  <td className="px-4 py-3 text-slate-600">{row.managerNames ?? "--"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.tradeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={result.page} pageCount={result.pageCount} searchParams={{ q: params.q, sort: params.sort }} />
    </div>
  );
}
