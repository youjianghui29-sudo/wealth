import Link from "next/link";
import { getAlertCenter } from "@/lib/queries";

export const dynamic = "force-dynamic";

type AlertItem = Awaited<ReturnType<typeof getAlertCenter>>["items"][number];

function levelLabel(level: AlertItem["level"]) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function levelClass(level: AlertItem["level"]) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-700";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function targetHref(item: AlertItem) {
  return item.targetType === "fund"
    ? `/funds/${encodeURIComponent(item.targetKey)}`
    : `/wealth/${encodeURIComponent(item.targetKey)}`;
}

function targetText(item: AlertItem) {
  return item.targetType === "fund" ? `基金 ${item.targetKey}` : `理财 ${item.targetKey}`;
}

export default async function AlertCenterPage() {
  const result = await getAlertCenter();
  const high = result.items.filter((item) => item.level === "high");
  const medium = result.items.filter((item) => item.level === "medium");
  const low = result.items.filter((item) => item.level === "low");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">预警中心</h1>
        <p className="mt-2 text-sm text-slate-600">集中展示高、中、低风险提醒，便于先看最需要处理的项目。</p>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <Card label="高风险" value={high.length} />
        <Card label="中风险" value={medium.length} />
        <Card label="低风险" value={low.length} />
      </section>

      <AlertSection title="高风险" items={high} />
      <AlertSection title="中风险" items={medium} />
      <AlertSection title="低风险" items={low} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function AlertSection({ title, items }: { title: string; items: AlertItem[] }) {
  return (
    <section className="rounded-md border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">
          {title}提醒 <span className="text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500">暂无 {title} 提醒</div>
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">级别</th>
                <th className="px-4 py-3 font-medium">对象</th>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">说明</th>
                <th className="px-4 py-3 font-medium">指标</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={`${item.metric}-${item.targetType}-${item.targetKey}-${item.title}`}>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${levelClass(item.level)}`}>
                      {levelLabel(item.level)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link href={targetHref(item)} className="focus-ring rounded font-medium text-ink">
                      {targetText(item)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">{item.title}</td>
                  <td className="px-4 py-3 align-top text-slate-600">{item.message}</td>
                  <td className="px-4 py-3 align-top text-slate-500">
                    <div>{item.metric}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
