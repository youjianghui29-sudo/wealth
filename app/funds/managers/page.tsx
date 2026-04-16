import { Pagination } from "@/components/Pagination";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundManagers } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FundManagersPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = { q: single(raw.q), page: single(raw.page) };
  const result = await getFundManagers(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金经理</h1>
        <p className="mt-2 text-sm text-slate-600">展示全市场基金经理、所属公司、现任基金数量和回报信息。</p>
      </div>
      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_100px]">
        <input name="q" defaultValue={params.q} placeholder="搜索经理或基金公司" className="focus-ring rounded-md border border-line px-3 py-2" />
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">筛选</button>
      </form>
      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 位经理</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">经理</th>
                <th className="px-4 py-3 font-medium">基金公司</th>
                <th className="px-4 py-3 text-right font-medium">现任基金数</th>
                <th className="px-4 py-3 text-right font-medium">最佳回报</th>
                <th className="px-4 py-3 text-right font-medium">累计回报</th>
                <th className="px-4 py-3 font-medium">起始日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-ink">{row.managerName}</td>
                  <td className="px-4 py-3 text-slate-600">{row.fundCompany ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{row.currentFundNum ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.bestReturn, 2)}%</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.totalReturn, 2)}%</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.startDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={result.page} pageCount={result.pageCount} searchParams={{ q: params.q }} />
    </div>
  );
}
