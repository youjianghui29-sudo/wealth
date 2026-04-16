import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundList } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FundsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    q: single(rawParams.q),
    type: single(rawParams.type),
    direction: single(rawParams.direction),
    minRate: single(rawParams.minRate),
    maxRate: single(rawParams.maxRate),
    sort: single(rawParams.sort),
    page: single(rawParams.page),
    pageSize: single(rawParams.pageSize)
  };
  const result = await getFundList(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金</h1>
        <p className="mt-2 text-sm text-slate-600">按最新单位净值和日增长率查看全量基金列表。</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/funds/rankings" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            查看基金排行
          </Link>
          <Link href="/funds/money" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            货币基金
          </Link>
          <Link href="/funds/exchange" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            场内基金
          </Link>
          <Link href="/funds/market" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            规模结构
          </Link>
          <Link href="/funds/ratings" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            评级
          </Link>
          <Link href="/funds/managers" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            基金经理
          </Link>
          <Link href="/funds/announcements" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            公告中心
          </Link>
          <Link href="/funds/dividends" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-steel">
            分红配送
          </Link>
        </div>
      </div>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_140px_140px_120px_120px_140px_100px]">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="搜索基金代码、名称、拼音"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <input
          name="type"
          defaultValue={params.type}
          placeholder="基金类型"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select
          name="direction"
          defaultValue={params.direction ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">全部涨跌</option>
          <option value="up">上涨</option>
          <option value="down">下跌</option>
          <option value="flat">平盘</option>
        </select>
        <input
          name="minRate"
          defaultValue={params.minRate}
          placeholder="最低涨幅%"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <input
          name="maxRate"
          defaultValue={params.maxRate}
          placeholder="最高涨幅%"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select
          name="sort"
          defaultValue={params.sort ?? "growth_desc"}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="growth_desc">涨幅从高到低</option>
          <option value="growth_asc">涨幅从低到高</option>
          <option value="name">名称排序</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">
          共 {result.total} 只基金
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">累计净值</th>
                <th className="px-4 py-3 text-right font-medium">日增长率</th>
                <th className="px-4 py-3 font-medium">交易日</th>
                <th className="px-4 py-3 font-medium">申购</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={row.code} className="hover:bg-paper/70">
                  <td className="px-4 py-3">
                    <Link href={`/funds/${encodeURIComponent(row.code)}`} className="focus-ring rounded font-medium text-ink">
                      {row.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">{row.code}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.fundType ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.unitNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.accumulatedNav)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.dailyGrowthRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.tradeDate)}</td>
                  <td className="px-4 py-3 text-slate-600">{row.purchaseStatus ?? "--"}</td>
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
          q: params.q,
          type: params.type,
          direction: params.direction,
          minRate: params.minRate,
          maxRate: params.maxRate,
          sort: params.sort
        }}
      />
    </div>
  );
}
