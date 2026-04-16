import Link from "next/link";
import { formatDate, formatNumber, formatPercent, trendClass } from "@/lib/format";
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
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseTargets(value: string | undefined) {
  return (value ?? "")
    .split(/[,，\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
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

export default async function ComparePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const targetsValue = single(raw.targets);
  const targets = parseTargets(targetsValue);
  const data = targets.length ? await getComparisonData(targets) : { items: [] };
  const items = data.items as ComparisonItem[];

  const rows = [
    { category: "收益", metric: "latestDate", label: "最新日期" },
    { category: "收益", metric: "latestValue", label: "最新值" },
    { category: "收益", metric: "dailyRate", label: "日涨跌" },
    { category: "收益", metric: "period:week_1", label: periodLabel("week_1") },
    { category: "收益", metric: "period:month_1", label: periodLabel("month_1") },
    { category: "收益", metric: "period:month_3", label: periodLabel("month_3") },
    { category: "收益", metric: "period:month_6", label: periodLabel("month_6") },
    { category: "收益", metric: "period:year_1", label: periodLabel("year_1") },
    { category: "收益", metric: "period:year_to_date", label: periodLabel("year_to_date") },
    { category: "收益", metric: "period:since_inception", label: periodLabel("since_inception") },
    { category: "风险", metric: "riskLevel", label: "类型 / 风险等级" },
    { category: "风险", metric: "maxDrawdown", label: "最大回撤" },
    { category: "风险", metric: "volatility", label: "波动率" },
    { category: "流动性", metric: "liquidity", label: "规模 / 期限" },
    { category: "流动性", metric: "manager", label: "管理人 / 发行机构" },
    { category: "费率", metric: "fee", label: "费率摘要" }
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">产品对比</h1>
        <p className="mt-2 text-sm text-slate-600">
          用 `targets` 查询参数传入逗号分隔的目标，支持 `fund:代码`、`wealth:登记编码`，也支持直接输入代码。
        </p>
      </div>

      <form className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_120px]">
          <input
            name="targets"
            defaultValue={targetsValue}
            placeholder="fund:022446, wealth:登记编码, 或直接输入代码"
            className="focus-ring rounded-md border border-line px-3 py-2"
          />
          <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
            对比
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-500">最多支持 8 个目标，系统会自动识别基金与理财。</p>
      </form>

      {items.length === 0 ? (
        <section className="rounded-md border border-dashed border-line bg-white p-6 text-sm leading-7 text-slate-600">
          先输入对比目标再查看结果，例如：`fund:022446, fund:000001, wealth:xxxx`
        </section>
      ) : (
        <section className="rounded-md border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {items.length} 个对比目标</div>
          <div className="table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-paper text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">指标</th>
                  {items.map((item) => (
                    <th className="px-4 py-3 font-medium" key={item.targetKey}>
                      <Link
                        href={item.targetType === "fund" ? `/funds/${encodeURIComponent(item.targetKey)}` : `/wealth/${encodeURIComponent(item.targetKey)}`}
                        className="focus-ring rounded font-medium text-ink"
                      >
                        {targetLabel(item)}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={`${row.category}-${row.metric}`}>
                    <td className="px-4 py-3 align-top">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{row.category}</div>
                      <div className="mt-1 font-medium text-ink">{row.label}</div>
                    </td>
                    {items.map((item) => (
                      <td className="px-4 py-3 align-top text-slate-700" key={`${item.targetKey}-${row.metric}`}>
                        {formatMetric(item, row.metric)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
