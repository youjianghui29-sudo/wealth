import Link from "next/link";
import { AddCompareButton } from "@/components/CompareTray";
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

const rangeLabels: Record<string, string> = {
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

export default async function FundsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    q: single(rawParams.q),
    type: single(rawParams.type),
    direction: single(rawParams.direction),
    purchaseStatus: single(rawParams.purchaseStatus),
    returnRange: single(rawParams.returnRange) ?? "year_1",
    minReturn: single(rawParams.minReturn),
    maxDrawdown: single(rawParams.maxDrawdown),
    minRate: single(rawParams.minRate),
    maxRate: single(rawParams.maxRate),
    sort: single(rawParams.sort) ?? "return_desc",
    page: single(rawParams.page),
    pageSize: single(rawParams.pageSize)
  };
  const result = await getFundList(params);
  const selectedRange = params.returnRange ?? "year_1";
  const selectedRangeLabel = rangeLabels[selectedRange] ?? "近1年";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金</h1>
        <p className="mt-2 text-sm text-slate-600">按申购状态、周期收益和样本回撤筛选候选基金。</p>
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

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel lg:grid-cols-[1fr_130px_130px_120px_120px_140px_160px_100px]">
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
          name="purchaseStatus"
          defaultValue={params.purchaseStatus ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">全部申购</option>
          <option value="开放">只看可申购</option>
          <option value="暂停">暂停申购</option>
          <option value="封闭">封闭期</option>
        </select>
        <select
          name="returnRange"
          defaultValue={selectedRange}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          {Object.entries(rangeLabels).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="minReturn"
          defaultValue={params.minReturn}
          placeholder="最低收益%"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select
          name="maxDrawdown"
          defaultValue={params.maxDrawdown ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">全部回撤</option>
          <option value="-5">回撤≤5%</option>
          <option value="-10">回撤≤10%</option>
          <option value="-20">回撤≤20%</option>
        </select>
        <select
          name="sort"
          defaultValue={params.sort ?? "return_desc"}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="return_desc">周期收益高到低</option>
          <option value="return_asc">周期收益低到高</option>
          <option value="drawdown_desc">回撤从低到高</option>
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
                <th className="px-4 py-3 text-right font-medium">{selectedRangeLabel}收益</th>
                <th className="px-4 py-3 text-right font-medium">样本回撤</th>
                <th className="px-4 py-3 text-right font-medium">日增长率</th>
                <th className="px-4 py-3 font-medium">交易日</th>
                <th className="px-4 py-3 font-medium">申购</th>
                <th className="px-4 py-3 font-medium">操作</th>
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
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.selectedReturn} />
                    <div className="mt-1 text-xs text-slate-500">{formatDate(row.selectedReturnDate)}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.maxDrawdown === null ? "--" : `${formatNumber(row.maxDrawdown, 2)}%`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.dailyGrowthRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.tradeDate)}</td>
                  <td className="px-4 py-3 text-slate-600">{row.purchaseStatus ?? "--"}</td>
                  <td className="px-4 py-3">
                    <AddCompareButton targetType="fund" targetKey={row.code} name={row.name} />
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
          q: params.q,
          type: params.type,
          direction: params.direction,
          purchaseStatus: params.purchaseStatus,
          returnRange: params.returnRange,
          minReturn: params.minReturn,
          maxDrawdown: params.maxDrawdown,
          minRate: params.minRate,
          maxRate: params.maxRate,
          sort: params.sort
        }}
      />
    </div>
  );
}
