import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundNavHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FundHistoryPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const rawParams = await searchParams;
  const fundCode = decodeURIComponent(code);
  const result = await getFundNavHistory(fundCode, {
    page: single(rawParams.page),
    pageSize: single(rawParams.pageSize)
  });

  if (!result) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{result.fund.code}</p>
          <h1 className="text-2xl font-semibold text-ink">{result.fund.name} 历史净值</h1>
          <p className="mt-2 text-sm text-slate-600">共 {result.total} 条净值记录，按交易日倒序展示。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/funds/${encodeURIComponent(result.fund.code)}`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            返回详情
          </Link>
          <a href={`/api/funds/${encodeURIComponent(result.fund.code)}/navs.csv`} className="focus-ring rounded-md border border-steel bg-white px-3 py-2 text-sm text-steel">
            下载 CSV
          </a>
        </div>
      </div>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">交易日</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">累计净值</th>
                <th className="px-4 py-3 text-right font-medium">前一净值</th>
                <th className="px-4 py-3 text-right font-medium">日增长值</th>
                <th className="px-4 py-3 text-right font-medium">日增长率</th>
                <th className="px-4 py-3 font-medium">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((nav) => (
                <tr key={nav.id}>
                  <td className="px-4 py-3">{formatDate(nav.tradeDate)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.unitNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.accumulatedNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.previousUnitNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.dailyGrowthValue)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={nav.dailyGrowthRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nav.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        searchParams={{ pageSize: single(rawParams.pageSize) }}
      />
    </div>
  );
}
