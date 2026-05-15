import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, formatNumber, formatPercent, trendClass } from "@/lib/format";
import { getComparisonWinnerKeys, parseCompareTargets, summarizeComparisonInsights } from "@/lib/fund-ux";
import { getComparisonData } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ComparisonPeriod =
  | { rangeKey: string; label?: string | null; rankValue?: number | null; rankDate?: Date | string | null }
  | { label: string; value?: number | null };

type ComparisonItem = {
  targetType: "fund" | "wealth";
  targetKey: string;
  name: string;
  latestDate: Date | string | null;
  latestValue: number | null;
  dailyRate: number | null;
  riskLevel: string | null;
  manager: string | null;
  scale: string | null;
  periodReturns: ComparisonPeriod[];
  maxDrawdown: number | null;
  volatility: number | null;
  fee: string | null;
  feeCost365d?: number | null;
  dataScore?: number | null;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function MobileMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-ink">{value}</div>
    </div>
  );
}

function targetLabel(item: ComparisonItem) {
  return `${item.name} / ${item.targetKey}`;
}

function periodLabel(rangeKey: string) {
  const mapping: Record<string, string> = {
    week_1: "近1周",
    month_1: "近1月",
    month_3: "近3月",
    month_6: "近6月",
    year_1: "近1年",
    year_to_date: "今年来",
    since_inception: "成立来"
  };

  return mapping[rangeKey] ?? rangeKey;
}

function getPeriodValue(item: ComparisonItem, key: string) {
  if (item.targetType === "fund") {
    const row = item.periodReturns.find((period): period is Extract<ComparisonPeriod, { rangeKey: string }> => "rangeKey" in period && period.rangeKey === key);
    return row?.rankValue ?? null;
  }

  const indexByKey: Record<string, number> = {
    month_1: 0,
    month_3: 1,
    month_6: 2
  };
  const row = item.periodReturns[indexByKey[key]];
  if (!row || "rangeKey" in row) {
    return null;
  }
  return row.value ?? null;
}

function formatMetric(item: ComparisonItem, metric: string) {
  switch (metric) {
    case "latestDate":
      return formatDate(item.latestDate);
    case "latestValue":
      return formatNumber(item.latestValue, 4);
    case "dailyRate":
      return <span className={trendClass(item.dailyRate)}>{formatPercent(item.dailyRate)}</span>;
    case "riskLevel":
      return item.riskLevel ?? "--";
    case "maxDrawdown":
      return <span className={trendClass(item.maxDrawdown)}>{formatPercent(item.maxDrawdown)}</span>;
    case "volatility":
      return item.volatility === null ? "--" : `${formatNumber(item.volatility, 2)}%`;
    case "liquidity":
      return item.scale ?? "--";
    case "manager":
      return item.manager ?? "--";
    case "fee":
      return item.fee ?? "--";
    default:
      if (metric.startsWith("period:")) {
        const key = metric.slice("period:".length);
        return <span className={trendClass(getPeriodValue(item, key))}>{formatPercent(getPeriodValue(item, key))}</span>;
      }
      return "--";
  }
}

function metricValue(item: ComparisonItem, metric: string) {
  switch (metric) {
    case "dailyRate":
      return item.dailyRate;
    case "maxDrawdown":
      return item.maxDrawdown;
    case "volatility":
      return item.volatility;
    default:
      return metric.startsWith("period:") ? getPeriodValue(item, metric.slice("period:".length)) : null;
  }
}

function targetId(item: ComparisonItem) {
  return `${item.targetType}:${item.targetKey}`;
}

function removeTargetHref(targets: string[], target: ComparisonItem) {
  const next = targets.filter((item) => item !== targetId(target));
  const query = next.join(",");
  return `/compare${query ? `?targets=${encodeURIComponent(query)}` : ""}`;
}

export default async function ComparePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const targetsValue = single(raw.targets);
  const targets = parseCompareTargets(targetsValue);
  const data = targets.length ? await getComparisonData(targets) : { items: [] };
  const items = data.items as ComparisonItem[];
  const insights = summarizeComparisonInsights(items.map((item) => ({
    key: targetId(item),
    name: item.name,
    metrics: {
      return1y: getPeriodValue(item, "year_1"),
      maxDrawdown: item.maxDrawdown,
      feeKnown: Boolean(item.fee),
      feeCost365d: item.feeCost365d ?? null,
      dataScore: item.dataScore ?? null
    }
  })));

  const rows = [
    { category: "收益", metric: "latestDate", label: "最新日期" },
    { category: "收益", metric: "latestValue", label: "最新值" },
    { category: "收益", metric: "dailyRate", label: "日涨跌", direction: "higher" },
    { category: "收益", metric: "period:week_1", label: periodLabel("week_1"), direction: "higher" },
    { category: "收益", metric: "period:month_1", label: periodLabel("month_1"), direction: "higher" },
    { category: "收益", metric: "period:month_3", label: periodLabel("month_3"), direction: "higher" },
    { category: "收益", metric: "period:month_6", label: periodLabel("month_6"), direction: "higher" },
    { category: "收益", metric: "period:year_1", label: periodLabel("year_1"), direction: "higher" },
    { category: "收益", metric: "period:year_to_date", label: periodLabel("year_to_date"), direction: "higher" },
    { category: "收益", metric: "period:since_inception", label: periodLabel("since_inception"), direction: "higher" },
    { category: "风险", metric: "riskLevel", label: "类型 / 风险等级" },
    { category: "风险", metric: "maxDrawdown", label: "最大回撤", direction: "lowerAbs" },
    { category: "风险", metric: "volatility", label: "波动率", direction: "lower" },
    { category: "流动性", metric: "liquidity", label: "规模 / 期限" },
    { category: "流动性", metric: "manager", label: "管理人 / 发行机构" },
    { category: "费率", metric: "fee", label: "费率摘要" }
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">产品对比</h1>
        <p className="mt-2 text-sm text-slate-600">
          直接输入基金代码或理财登记编码，一行一个或用逗号分隔。系统会自动识别基金和理财，最多对比 8 个。
        </p>
      </div>

      <form className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_120px]">
          <textarea
            name="targets"
            defaultValue={targetsValue}
            placeholder={"011815, 006081\n或粘贴多个基金代码/理财登记编码"}
            className="focus-ring min-h-24 rounded-md border border-line px-3 py-2"
          />
          <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
            对比
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/compare?targets=011815,006081,006751" className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-slate-700">
            科技成长样例
          </Link>
          <Link href="/funds/candidates" className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-slate-700">
            从候选池添加
          </Link>
          <Link href="/funds/watchlist" className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-slate-700">
            从关注池添加
          </Link>
        </div>
      </form>

      {items.length === 0 ? (
        <section className="rounded-md border border-dashed border-line bg-white p-6 text-sm leading-7 text-slate-600">
          先输入 2 到 8 个对比目标。基金可以直接输入 6 位代码；理财产品输入登记编码。也可以先去候选池点“加入对比”，底部会出现对比栏。
        </section>
      ) : (
        <>
        <section className="grid gap-3 md:grid-cols-4">
          {insights.map((item) => (
            <div key={item.key} className="rounded-md border border-line bg-white p-4 text-sm shadow-panel">
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className="mt-2 font-semibold text-ink">{item.winnerName ?? "待确认"}</div>
              <p className="mt-2 leading-6 text-slate-600">{item.detail}</p>
            </div>
          ))}
        </section>
        <section className="rounded-md border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3 text-sm text-slate-600">
            共 {items.length} 个对比目标，浅绿色为该指标相对占优
          </div>
          <div className="hidden md:block table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-paper text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">指标</th>
                  {items.map((item) => (
                    <th className="px-4 py-3 font-medium" key={item.targetKey}>
                      <div className="flex flex-col gap-1">
                        <Link
                          href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                          className="focus-ring rounded font-medium text-ink"
                        >
                          {targetLabel(item)}
                        </Link>
                        <Link href={removeTargetHref(targets, item)} className="focus-ring rounded text-xs text-slate-500">
                          移除
                        </Link>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const winnerKeys =
                    "direction" in row && row.direction
                      ? new Set(getComparisonWinnerKeys(items.map((item) => ({ key: targetId(item), value: metricValue(item, row.metric) })), row.direction))
                      : new Set<string>();
                  return (
                    <tr key={`${row.category}-${row.metric}`}>
                      <td className="px-4 py-3 align-top">
                        <div className="text-xs uppercase tracking-wide text-slate-500">{row.category}</div>
                        <div className="mt-1 font-medium text-ink">{row.label}</div>
                      </td>
                      {items.map((item) => (
                        <td
                          className={`px-4 py-3 align-top text-slate-700 ${winnerKeys.has(targetId(item)) ? "bg-mint/10 font-medium text-ink" : ""}`}
                          key={`${item.targetKey}-${row.metric}`}
                        >
                          {formatMetric(item, row.metric)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 md:hidden">
            {items.map((item) => (
              <div key={`card-${targetId(item)}`} className="rounded-md border border-line bg-paper p-3 text-sm">
                <Link
                  href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                  className="focus-ring rounded font-semibold text-ink"
                >
                  {targetLabel(item)}
                </Link>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <MobileMetric label="日涨跌" value={<span className={trendClass(item.dailyRate)}>{formatPercent(item.dailyRate)}</span>} />
                  <MobileMetric label="近一年" value={<span className={trendClass(getPeriodValue(item, "year_1"))}>{formatPercent(getPeriodValue(item, "year_1"))}</span>} />
                  <MobileMetric label="最大回撤" value={<span className={trendClass(item.maxDrawdown)}>{formatPercent(item.maxDrawdown)}</span>} />
                  <MobileMetric label="费率" value={item.fee ?? "--"} />
                </div>
                <Link href={removeTargetHref(targets, item)} className="focus-ring mt-3 inline-flex rounded-md border border-line bg-white px-3 py-2 text-xs text-slate-700">
                  移除
                </Link>
              </div>
            ))}
          </div>
        </section>
        </>
      )}
    </div>
  );
}
