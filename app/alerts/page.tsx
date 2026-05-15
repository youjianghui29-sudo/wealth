import { AlertCenterClient } from "@/components/AlertCenterClient";
import { getAlertActionStates, getAlertCenter } from "@/lib/queries";

export const dynamic = "force-dynamic";

function alertId(item: Awaited<ReturnType<typeof getAlertCenter>>["items"][number]) {
  return `${item.metric}:${item.targetType}:${item.targetKey}:${item.title}`;
}

export default async function AlertCenterPage() {
  const [result, states] = await Promise.all([getAlertCenter(), getAlertActionStates()]);
  const items = result.items.map((item) => ({
    ...item,
    id: alertId(item)
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">预警中心</h1>
        <p className="mt-2 text-sm text-slate-600">集中展示高、中、低风险提醒，处理、延后或关闭后，列表会按本机状态自动收起。</p>
      </div>
      <AlertCenterClient items={items} initialStates={states} />
    </div>
  );
}
