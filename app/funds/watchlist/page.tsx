import Link from "next/link";
import { AddCompareButton } from "@/components/CompareTray";
import { TrendBadge } from "@/components/TrendBadge";
import { WatchButton } from "@/components/WatchButton";
import { formatDate, formatNumber } from "@/lib/format";
import { buildFundTradeAction, getDecisionQueueMissingFields, groupWatchlistDecisions, type WatchlistStatus } from "@/lib/fund-ux";
import { getFundWatchlistWorkbench } from "@/lib/queries";

export const dynamic = "force-dynamic";

type WatchlistItem = Awaited<ReturnType<typeof getFundWatchlistWorkbench>>["items"][number];

const groupMeta: Array<{ key: WatchlistStatus; label: string; helper: string }> = [
  { key: "ready_to_buy", label: "准备买入", helper: "条件已接近执行，优先复核金额、仓位和费用" },
  { key: "waiting_pullback", label: "等待回调", helper: "等待价格、回撤或同类排名进入设定区间" },
  { key: "researching", label: "待研究", helper: "资料、费率、持仓或买入理由还没有核完" },
  { key: "bought", label: "已买入复盘", helper: "跟踪买后表现、回撤、公告和组合集中度" },
  { key: "rejected", label: "已放弃", helper: "保留放弃原因，避免反复研究同一个问题" }
];

function statusLabel(status: WatchlistStatus) {
  return groupMeta.find((item) => item.key === status)?.label ?? "待研究";
}

export default async function FundWatchlistWorkbenchPage() {
  const result = await getFundWatchlistWorkbench();
  const grouped = groupWatchlistDecisions(result.items);
  const actionableCount = grouped.ready_to_buy.length + grouped.waiting_pullback.length;
  const missingCount = result.items.filter((item) => getDecisionQueueMissingFields(item).length > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">关注工作台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            把关注池按下一步动作拆开，先处理准备买入和等待回调的标的，再补齐缺少买入条件、放弃条件或复盘日期的记录。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/funds/candidates" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            观察候选池
          </Link>
          <Link href="/compare" className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            产品对比
          </Link>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="关注总数" value={result.items.length} />
        <SummaryCard label="待执行/回调" value={actionableCount} />
        <SummaryCard label="缺少决策条件" value={missingCount} />
        <SummaryCard label="已买入复盘" value={grouped.bought.length} />
      </section>

      {result.items.length === 0 ? (
        <section className="rounded-md border border-dashed border-line bg-white p-6 text-sm text-slate-600">
          暂无关注标的。可以先从候选池或基金详情页加入关注，再补充买入条件、放弃条件和复盘日期。
        </section>
      ) : (
        groupMeta.map((group) => <WatchlistGroup key={group.key} meta={group} items={grouped[group.key]} />)
      )}
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

function WatchlistGroup({
  meta,
  items
}: {
  meta: { key: WatchlistStatus; label: string; helper: string };
  items: WatchlistItem[];
}) {
  return (
    <section className="rounded-md border border-line bg-white shadow-panel">
      <div className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold text-ink">
            {meta.label} <span className="text-sm font-normal text-slate-500">({items.length})</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">{meta.helper}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500">暂无{meta.label}标的</div>
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">标的</th>
                <th className="px-4 py-3 text-right font-medium">最新值</th>
                <th className="px-4 py-3 text-right font-medium">日涨跌</th>
                <th className="px-4 py-3 text-right font-medium">近1年</th>
                <th className="px-4 py-3 font-medium">下一步</th>
                <th className="px-4 py-3 font-medium">决策条件</th>
                <th className="px-4 py-3 font-medium">复盘</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => {
                const missing = getDecisionQueueMissingFields(item);
                const targetType = item.targetType === "wealth" ? "wealth" : "fund";
                const action = buildFundTradeAction({
                  held: item.observationStatus === "bought",
                  dataScore: missing.length ? 60 : 75,
                  purchaseOpen: /开放|申购|销售/.test(item.purchaseStatus ?? ""),
                  profitRate: item.profitRate ?? null,
                  peerPercentile: null,
                  maxDrawdown: item.dailyRate !== null && item.dailyRate <= -3 ? -16 : null,
                  maxDrawdownTolerance: item.maxDrawdownTolerance,
                  highImpactAnnouncementCount: 0,
                  positionStatus: item.positionWeight !== null && item.positionWeight >= item.maxPositionWeight ? "over_limit" : "within_limit",
                  tradeWindowState: "before_cutoff"
                });
                return (
                  <tr key={`${item.targetType}-${item.targetKey}`} className="hover:bg-paper/70">
                    <td className="px-4 py-3 align-top">
                      <Link href={item.href} className="focus-ring rounded font-medium text-ink">
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.targetKey} · {targetType === "fund" ? "基金" : "理财"} · {item.purchaseStatus ?? "--"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">状态：{statusLabel(item.observationStatus)}</div>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {formatNumber(item.latestValue, 4)}
                      <div className="mt-1 text-xs text-slate-500">{formatDate(item.latestDate)}</div>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <TrendBadge value={item.dailyRate} />
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <TrendBadge value={item.yearReturn} />
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
                          action.priority === "high" ? "bg-coral/10 text-coral" : action.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-paper text-slate-600"
                        }`}
                      >
                        {action.action}
                      </span>
                      <div className="mt-1 max-w-48 text-xs leading-5 text-slate-500">{action.reasons[0]}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">
                      <div>买入：{item.buyCondition || "未填写"}</div>
                      <div className="mt-1">放弃：{item.rejectCondition || "未填写"}</div>
                      {missing.length ? <div className="mt-2 text-xs text-amber-700">待补：{missing.join("、")}</div> : null}
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600">
                      <div>{item.reviewDate || "未设置"}</div>
                      {item.reviewNote ? <div className="mt-1 max-w-64 text-xs text-slate-500">{item.reviewNote}</div> : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2">
                        <WatchButton targetType={targetType} code={item.targetKey} initialWatched />
                        <AddCompareButton targetType={targetType} targetKey={item.targetKey} name={item.name} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
