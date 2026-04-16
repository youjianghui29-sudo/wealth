import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundRankings } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const rangeLabels: Record<string, string> = {
  daily_growth_rate: "日增长率",
  week_1: "近1周",
  month_1: "近1月",
  month_3: "近3月",
  month_6: "近6月",
  year_1: "近1年",
  year_2: "近2年",
  year_3: "近3年",
  year_to_date: "今年来",
  since_inception: "成立来"
};

export default async function FundRankingsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    rangeKey: single(rawParams.rangeKey),
    direction: single(rawParams.direction),
    page: single(rawParams.page),
    pageSize: single(rawParams.pageSize)
  };
  const result = await getFundRankings(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金排行</h1>
        <p className="mt-2 text-sm text-slate-600">
          当前展示已入库的排行指标。最新排行日：{formatDate(result.latestRankDate)}
        </p>
      </div>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[180px_180px_100px]">
        <select
          name="rangeKey"
          defaultValue={params.rangeKey ?? "daily_growth_rate"}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          {result.rangeKeys.length === 0 ? <option value="daily_growth_rate">日增长率</option> : null}
          {result.rangeKeys.map((key) => (
            <option key={key} value={key}>
              {rangeLabels[key] ?? key}
            </option>
          ))}
        </select>
        <select
          name="direction"
          defaultValue={params.direction ?? "desc"}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="desc">从高到低</option>
          <option value="asc">从低到高</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">
          共 {result.total} 条排行记录
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">名次</th>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">排行值</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">最新日增长率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row, index) => (
                <tr key={`${row.fundCode}-${row.rangeKey}`} className="hover:bg-paper/70">
                  <td className="px-4 py-3 text-slate-600">{(result.page - 1) * result.pageSize + index + 1}</td>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${encodeURIComponent(row.fundCode)}`} className="focus-ring rounded font-medium text-ink">
                      {row.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">{row.fundCode}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.fundType ?? "--"}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.rankValue} />
                  </td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.unitNav)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.dailyGrowthRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        searchParams={{
          rangeKey: params.rangeKey,
          direction: params.direction
        }}
      />
    </div>
  );
}
