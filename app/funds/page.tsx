import Link from "next/link";
import { AddCompareButton } from "@/components/CompareTray";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { formatSampleScope } from "@/lib/fund-ux";
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

const candidateViews = [
  { key: "candidates", label: "观察候选池", href: "/funds/candidates", note: "按观察分筛出可继续跟踪的基金" },
  { key: "all", label: "全量搜索", href: "/funds", note: "保留完整列表和高级筛选" },
  { key: "watchlist", label: "我的关注", href: "/funds/watchlist", note: "按下一步动作管理关注池" },
  { key: "strong_week", label: "近周强势", href: "/funds?view=strong_week&sort=return_desc", note: "近1周收益靠前" },
  { key: "strong_quarter", label: "近三月强势", href: "/funds?view=strong_quarter&sort=return_desc", note: "近3月收益靠前" },
  { key: "low_drawdown", label: "回撤较低", href: "/funds?view=low_drawdown&sort=drawdown_desc", note: "样本回撤不超过10%" },
  { key: "open_purchase", label: "开放申购", href: "/funds?view=open_purchase", note: "排除明显暂停申购" },
  { key: "data_ready", label: "数据较完整", href: "/funds?view=data_ready", note: "历史、资料、费率较完整" }
];

const fundTypeChips = ["混合型", "股票型", "债券型", "指数型", "货币型", "QDII", "ETF", "FOF"];

export default async function FundsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    q: single(rawParams.q),
    type: single(rawParams.type),
    direction: single(rawParams.direction),
    purchaseStatus: single(rawParams.purchaseStatus),
    view: single(rawParams.view) ?? "all",
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
  const selectedRange = params.view === "strong_week" ? "week_1" : params.view === "strong_quarter" ? "month_3" : params.returnRange ?? "year_1";
  const selectedRangeLabel = rangeLabels[selectedRange] ?? "近1年";
  const typeHref = (type?: string) => {
    const search = new URLSearchParams();
    const next = { ...params, type, page: undefined };
    for (const [key, value] of Object.entries(next)) {
      if (value && key !== "page") {
        search.set(key, String(value));
      }
    }
    const query = search.toString();
    return `/funds${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金</h1>
        <p className="mt-2 text-sm text-slate-600">先用候选池缩小范围，再按申购状态、周期收益、样本回撤和数据完整度筛选。</p>
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

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {candidateViews.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`focus-ring rounded-md border p-3 text-sm ${
              params.view === item.key ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700"
            }`}
          >
            <span className="block font-medium">{item.label}</span>
            <span className={`mt-1 block text-xs ${params.view === item.key ? "text-white/75" : "text-slate-500"}`}>{item.note}</span>
          </Link>
        ))}
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">按类型快速筛选</h2>
            <p className="mt-1 text-xs text-slate-500">保留关键词搜索，类型用固定入口减少误输入。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={typeHref(undefined)}
              className={`focus-ring rounded-md border px-3 py-2 ${params.type ? "border-line bg-white text-slate-700" : "border-ink bg-ink text-white"}`}
            >
              全部类型
            </Link>
            {fundTypeChips.map((type) => (
              <Link
                key={type}
                href={typeHref(type)}
                className={`focus-ring rounded-md border px-3 py-2 ${params.type === type ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700"}`}
              >
                {type}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel lg:grid-cols-[1fr_130px_120px_120px_140px_160px_100px]">
        {params.view !== "all" ? <input type="hidden" name="view" value={params.view} /> : null}
        {params.type ? <input type="hidden" name="type" value={params.type} /> : null}
        <input
          name="q"
          defaultValue={params.q}
          placeholder="搜索基金代码、名称、拼音"
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
        <div className="hidden md:block table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">{selectedRangeLabel}收益</th>
                <th className="px-4 py-3 text-right font-medium">样本回撤</th>
                <th className="px-4 py-3 text-right font-medium">数据可信度</th>
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
                  <td className="px-4 py-3 text-slate-600">
                    {row.fundType ?? "--"}
                    {row.fundTypeSource && row.fundTypeSource !== "source" ? (
                      <div className="mt-1 text-xs text-slate-500">推断</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.unitNav)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.selectedReturn} />
                    <div className="mt-1 text-xs text-slate-500">{formatDate(row.selectedReturnDate)}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.maxDrawdown === null ? "--" : `${formatNumber(row.maxDrawdown, 2)}%`}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatNumber(row.dataCompleteness, 0)}
                    {row.dataQualityLabel ? <span className="ml-1 text-xs text-slate-500">{row.dataQualityLabel}</span> : null}
                    <div className="mt-1 text-xs text-slate-500">
                      {formatSampleScope({ recentCount: row.navSampleCount })} · {row.hasProfile ? "资料" : "缺资料"} · {row.hasFee ? "费率" : "缺费率"}
                    </div>
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
        <div className="grid gap-3 p-4 md:hidden">
          {result.items.map((row) => (
            <div key={`card-${row.code}`} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/funds/${encodeURIComponent(row.code)}`} className="focus-ring rounded font-semibold text-ink">
                    {row.name}
                  </Link>
                  <div className="mt-1 text-xs text-slate-500">{row.code} / {row.fundType ?? "--"}</div>
                </div>
                <TrendBadge value={row.dailyGrowthRate} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div>周期收益</div>
                  <div className="mt-1"><TrendBadge value={row.selectedReturn} /></div>
                </div>
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div>样本回撤</div>
                  <div className="mt-1 font-medium text-ink">{row.maxDrawdown === null ? "--" : `${formatNumber(row.maxDrawdown, 2)}%`}</div>
                </div>
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div>数据可信</div>
                  <div className="mt-1 font-medium text-ink">{formatNumber(row.dataCompleteness, 0)} {row.dataQualityLabel ?? ""}</div>
                </div>
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div>申购</div>
                  <div className="mt-1 font-medium text-ink">{row.purchaseStatus ?? "--"}</div>
                </div>
              </div>
              <div className="mt-3">
                <AddCompareButton targetType="fund" targetKey={row.code} name={row.name} />
              </div>
            </div>
          ))}
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
          view: params.view === "all" ? undefined : params.view,
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
