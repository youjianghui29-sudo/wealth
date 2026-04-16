import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { formatNumber } from "@/lib/format";
import { getFundRatings } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FundRatingsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = { q: single(raw.q), page: single(raw.page) };
  const result = await getFundRatings(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金评级</h1>
        <p className="mt-2 text-sm text-slate-600">展示上海证券、招商证券、济安金信、晨星评级等数据。</p>
      </div>
      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_100px]">
        <input name="q" defaultValue={params.q} placeholder="搜索基金、公司或代码" className="focus-ring rounded-md border border-line px-3 py-2" />
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">筛选</button>
      </form>
      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 条评级</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">公司</th>
                <th className="px-4 py-3 text-right font-medium">五星家数</th>
                <th className="px-4 py-3 text-right font-medium">上海证券</th>
                <th className="px-4 py-3 text-right font-medium">招商证券</th>
                <th className="px-4 py-3 text-right font-medium">济安金信</th>
                <th className="px-4 py-3 text-right font-medium">晨星</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${encodeURIComponent(row.fundCode)}`} className="focus-ring rounded font-medium text-ink">{row.fundName ?? row.fundCode}</Link>
                    <div className="mt-1 text-xs text-slate-500">{row.fundCode} · {row.fundType ?? "--"}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.fundCompany ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{row.fiveStarCount ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.shRating, 1)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.zsRating, 1)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.jaRating, 1)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.morningstar, 1)}</td>
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
