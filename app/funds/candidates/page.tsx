import Link from "next/link";
import { AddCompareButton } from "@/components/CompareTray";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { WatchButton } from "@/components/WatchButton";
import { formatDate, formatNumber } from "@/lib/format";
import { buildFundTradeAction, formatSampleScope } from "@/lib/fund-ux";
import { getFundCandidatePool } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function scoreClass(score: number) {
  if (score >= 75) return "bg-mint/10 text-mint";
  if (score >= 60) return "bg-steel/10 text-steel";
  return "bg-amber-100 text-amber-700";
}

function tierLabel(tier: string | undefined) {
  if (tier === "strong") return "重点";
  if (tier === "watchable") return "可观察";
  return "谨慎";
}

const gradeLinks = [
  { key: "all", label: "全部候选", note: "按观察分排序", href: "/funds/candidates" },
  { key: "strong", label: "重点观察", note: "只保留观察分靠前的前 60 只", href: "/funds/candidates?grade=strong" },
  { key: "watchable", label: "可以观察", note: "重点池之外的可跟踪标的", href: "/funds/candidates?grade=watchable" },
  { key: "cautious", label: "谨慎观察", note: "分数、数据或风险仍需确认", href: "/funds/candidates?grade=cautious" }
];

const fundTypeChips = ["混合型", "股票型", "债券型", "指数型", "QDII", "ETF", "FOF"];

export default async function FundCandidatesPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    type: single(rawParams.type),
    grade: single(rawParams.grade) ?? "all",
    sort: single(rawParams.sort) ?? "score",
    page: single(rawParams.page)
  };
  const result = await getFundCandidatePool(params);
  const typeHref = (type?: string) => {
    const search = new URLSearchParams();
    const next = { ...params, type, page: undefined };
    for (const [key, value] of Object.entries(next)) {
      if (value && key !== "page") {
        search.set(key, String(value));
      }
    }
    const query = search.toString();
    return `/funds/candidates${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">观察候选池</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            基于公开数据自动筛出值得继续跟踪的基金，只作为观察清单，不构成投资建议。入池逻辑优先看数据可信度、阶段收益、同类百分位、回撤、申购状态和公告风险。
          </p>
        </div>
        <Link href="/funds/watchlist" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
          查看我的关注
        </Link>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="扫描样本" value={result.summary.totalScanned} />
        <SummaryCard label="重点观察" value={result.summary.strongCount} />
        <SummaryCard label="可以观察" value={result.summary.watchableCount} />
        <SummaryCard label="谨慎观察" value={result.summary.cautiousCount} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {gradeLinks.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`focus-ring rounded-md border p-3 text-sm ${
              params.grade === item.key ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700"
            }`}
          >
            <span className="block font-medium">{item.label}</span>
            <span className={`mt-1 block text-xs ${params.grade === item.key ? "text-white/75" : "text-slate-500"}`}>{item.note}</span>
          </Link>
        ))}
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="mb-3 text-sm font-semibold text-ink">候选类型</div>
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
      </section>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_160px_100px]">
        {params.grade !== "all" ? <input type="hidden" name="grade" value={params.grade} /> : null}
        {params.type ? <input type="hidden" name="type" value={params.type} /> : null}
        <select name="sort" defaultValue={params.sort} className="focus-ring rounded-md border border-line px-3 py-2">
          <option value="score">观察分优先</option>
          <option value="drawdown">低回撤优先</option>
          <option value="year">近 1 年收益优先</option>
          <option value="data">数据可信度优先</option>
        </select>
        <Link href="/funds/candidates" className="focus-ring rounded-md border border-line px-4 py-2 text-center text-slate-700">
          重置
        </Link>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">
          共 {result.total.toLocaleString("zh-CN")} 只候选基金，生成时间 {formatDate(result.summary.generatedAt)}
        </div>
        <div className="hidden md:block table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 text-right font-medium">观察分</th>
                <th className="px-4 py-3 font-medium">下一步</th>
                <th className="px-4 py-3 text-right font-medium">近 3 月</th>
                <th className="px-4 py-3 text-right font-medium">近 6 月</th>
                <th className="px-4 py-3 text-right font-medium">近 1 年</th>
                <th className="px-4 py-3 text-right font-medium">同类百分位</th>
                <th className="px-4 py-3 text-right font-medium">样本回撤</th>
                <th className="px-4 py-3 font-medium">入选原因</th>
                <th className="px-4 py-3 font-medium">风险提示</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    暂无符合条件的观察候选。
                  </td>
                </tr>
              ) : (
                result.items.map((item) => {
                  const action = buildFundTradeAction({
                    held: false,
                    dataScore: item.dataScore,
                    purchaseOpen: /开放|申购/.test(item.purchaseStatus ?? ""),
                    peerPercentile: item.peerPercentile,
                    maxDrawdown: item.maxDrawdown,
                    highImpactAnnouncementCount: item.highImpactAnnouncementCount,
                    positionStatus: "within_limit",
                    tradeWindowState: "before_cutoff"
                  });
                  return (
                  <tr key={item.code} className="hover:bg-paper/70">
                    <td className="px-4 py-3">
                      <Link href={`/funds/${encodeURIComponent(item.code)}`} className="focus-ring rounded font-medium text-ink">
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.code} / {item.fundType ?? "--"} / {item.purchaseStatus ?? "--"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatSampleScope({ recentCount: item.navSampleCount })}，数据分 {item.dataScore}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`rounded-md px-2 py-1 text-sm font-semibold ${scoreClass(item.observationScore)}`}>
                        {item.observationScore}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{tierLabel(item.observationTier)}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
                          action.priority === "high" ? "bg-coral/10 text-coral" : action.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-paper text-slate-600"
                        }`}
                      >
                        {action.action}
                      </span>
                      <div className="mt-1 max-w-48 text-xs leading-5 text-slate-500">{action.reasons[0]}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.month3Return} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.month6Return} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.year1Return} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.peerPercentile, 1)}%</td>
                    <td className="px-4 py-3 text-right">
                      {item.maxDrawdown === null ? "--" : `${formatNumber(item.maxDrawdown, 2)}%`}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <ReasonList items={item.reasons} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <ReasonList items={item.risks.length ? item.risks : ["暂无明显触发项"]} muted={!item.risks.length} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <WatchButton targetType="fund" code={item.code} initialWatched={item.watched} />
                        <AddCompareButton targetType="fund" targetKey={item.code} name={item.name} />
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-4 md:hidden">
          {result.items.length === 0 ? (
            <div className="rounded-md border border-line bg-paper p-4 text-center text-sm text-slate-500">
              暂无符合条件的观察候选。
            </div>
          ) : (
            result.items.map((item) => {
              const action = buildFundTradeAction({
                held: false,
                dataScore: item.dataScore,
                purchaseOpen: /开放申购/.test(item.purchaseStatus ?? ""),
                peerPercentile: item.peerPercentile,
                maxDrawdown: item.maxDrawdown,
                highImpactAnnouncementCount: item.highImpactAnnouncementCount,
                positionStatus: "within_limit",
                tradeWindowState: "before_cutoff"
              });
              return (
                <div key={`card-${item.code}`} className="rounded-md border border-line bg-paper p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/funds/${encodeURIComponent(item.code)}`} className="focus-ring rounded font-semibold text-ink">
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.code} / {item.fundType ?? "--"}</div>
                    </div>
                    <span className={`rounded-md px-2 py-1 text-sm font-semibold ${scoreClass(item.observationScore)}`}>
                      {item.observationScore}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="rounded-md border border-line bg-white px-3 py-2">
                      <div>下一步</div>
                      <div className="mt-1 font-medium text-ink">{action.action}</div>
                    </div>
                    <div className="rounded-md border border-line bg-white px-3 py-2">
                      <div>近一年</div>
                      <div className="mt-1"><TrendBadge value={item.year1Return} /></div>
                    </div>
                    <div className="rounded-md border border-line bg-white px-3 py-2">
                      <div>同类百分位</div>
                      <div className="mt-1 font-medium text-ink">{formatNumber(item.peerPercentile, 1)}%</div>
                    </div>
                    <div className="rounded-md border border-line bg-white px-3 py-2">
                      <div>回撤</div>
                      <div className="mt-1 font-medium text-ink">{item.maxDrawdown === null ? "--" : `${formatNumber(item.maxDrawdown, 2)}%`}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <WatchButton targetType="fund" code={item.code} initialWatched={item.watched} />
                    <AddCompareButton targetType="fund" targetKey={item.code} name={item.name} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        searchParams={{
          type: params.type,
          grade: params.grade === "all" ? undefined : params.grade,
          sort: params.sort
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value.toLocaleString("zh-CN")}</div>
    </div>
  );
}

function ReasonList({ items, muted = false }: { items: string[]; muted?: boolean }) {
  return (
    <div className={`flex max-w-60 flex-wrap gap-1 text-xs ${muted ? "text-slate-500" : ""}`}>
      {items.slice(0, 4).map((item) => (
        <span key={item} className="rounded-md border border-line bg-paper px-2 py-1">
          {item}
        </span>
      ))}
    </div>
  );
}
