import { formatPercent, trendClass } from "@/lib/format";

export function TrendBadge({ value }: { value: number | null | undefined }) {
  return (
    <span className={`inline-flex min-w-20 justify-end font-semibold ${trendClass(value)}`}>
      {formatPercent(value)}
    </span>
  );
}
