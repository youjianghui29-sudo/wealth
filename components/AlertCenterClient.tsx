"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { applyAlertActionState, type AlertActionState } from "@/lib/fund-ux";

type AlertItem = {
  id: string;
  level: "high" | "medium" | "low";
  targetType: "fund" | "wealth";
  targetKey: string;
  title: string;
  message: string;
  metric: string;
};

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

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function AlertCenterClient({
  items,
  initialStates = {}
}: {
  items: AlertItem[];
  initialStates?: Record<string, AlertActionState | undefined>;
}) {
  const [states, setStates] = useState<Record<string, AlertActionState | undefined>>(initialStates);

  const visibleItems = useMemo(() => applyAlertActionState(items, states), [items, states]);
  const high = visibleItems.filter((item) => item.level === "high");
  const medium = visibleItems.filter((item) => item.level === "medium");
  const low = visibleItems.filter((item) => item.level === "low");

  async function setAction(id: string, state: AlertActionState) {
    setStates((current) => {
      const next = { ...current, [id]: state };
      return next;
    });
    await fetch("/api/alert-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: id, ...state })
    });
  }

  async function resetActions() {
    setStates({});
    await fetch("/api/alert-actions", { method: "DELETE" });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-4">
        <Card label="高风险" value={high.length} />
        <Card label="中风险" value={medium.length} />
        <Card label="低风险" value={low.length} />
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <div className="text-sm text-slate-600">已处理/延后</div>
          <button type="button" onClick={resetActions} className="focus-ring mt-2 rounded-md border border-line bg-paper px-3 py-2 text-sm text-slate-700">
            恢复全部提醒
          </button>
        </div>
      </section>

      <AlertSection title="高风险" items={high} onAction={setAction} />
      <AlertSection title="中风险" items={medium} onAction={setAction} />
      <AlertSection title="低风险" items={low} onAction={setAction} />
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

function AlertSection({
  title,
  items,
  onAction
}: {
  title: string;
  items: AlertItem[];
  onAction: (id: string, state: AlertActionState) => void;
}) {
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
        <>
        <div className="hidden md:block table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">级别</th>
                <th className="px-4 py-3 font-medium">对象</th>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">说明</th>
                <th className="px-4 py-3 font-medium">处理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${levelClass(item.level)}`}>
                      {levelLabel(item.level)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link href={targetHref(item)} className="focus-ring rounded font-medium text-ink">
                      {targetText(item)}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">{item.metric}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">{item.title}</td>
                  <td className="px-4 py-3 align-top text-slate-600">{item.message}</td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onAction(item.id, { action: "done" })}
                        className="focus-ring rounded-md border border-line bg-paper px-2 py-1 text-xs text-slate-700"
                      >
                        已处理
                      </button>
                      <button
                        type="button"
                        onClick={() => onAction(item.id, { action: "snooze", until: tomorrowDate() })}
                        className="focus-ring rounded-md border border-line bg-paper px-2 py-1 text-xs text-slate-700"
                      >
                        明天再看
                      </button>
                      <button
                        type="button"
                        onClick={() => onAction(item.id, { action: "reject" })}
                        className="focus-ring rounded-md border border-line bg-paper px-2 py-1 text-xs text-slate-700"
                      >
                        不再提示
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-4 md:hidden">
          {items.map((item) => (
            <div key={`card-${item.id}`} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${levelClass(item.level)}`}>
                  {levelLabel(item.level)}
                </span>
                <Link href={targetHref(item)} className="focus-ring rounded text-xs text-slate-600">
                  {targetText(item)}
                </Link>
              </div>
              <div className="mt-3 font-medium text-ink">{item.title}</div>
              <p className="mt-2 leading-6 text-slate-600">{item.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onAction(item.id, { action: "done" })}
                  className="focus-ring rounded-md border border-line bg-white px-2 py-1 text-xs text-slate-700"
                >
                  已处理
                </button>
                <button
                  type="button"
                  onClick={() => onAction(item.id, { action: "snooze", until: tomorrowDate() })}
                  className="focus-ring rounded-md border border-line bg-white px-2 py-1 text-xs text-slate-700"
                >
                  明天再看
                </button>
                <button
                  type="button"
                  onClick={() => onAction(item.id, { action: "reject" })}
                  className="focus-ring rounded-md border border-line bg-white px-2 py-1 text-xs text-slate-700"
                >
                  不再提示
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </section>
  );
}
