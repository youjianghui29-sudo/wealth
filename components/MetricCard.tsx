type MetricCardProps = {
  label: string;
  value: string | number;
  helper?: string;
};

export function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
    </div>
  );
}
