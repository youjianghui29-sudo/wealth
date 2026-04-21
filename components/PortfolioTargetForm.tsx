"use client";

import { FormEvent, useState } from "react";
import { formatNumber } from "@/lib/format";

type TargetRow = {
  targetKey: string;
  label: string;
  targetWeight: number | null;
  maxWeight: number | null;
  currentWeight: number;
  deviation: number | null;
  note: string | null;
  status: string;
};

export function PortfolioTargetForm({ targets }: { targets: TargetRow[] }) {
  const [rows, setRows] = useState(targets);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(index: number, key: "targetWeight" | "maxWeight", value: string) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value === "" ? null : Number(value) } : row
      )
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/portfolio/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: rows })
    });
    const payload = (await response.json()) as { error?: string; saved?: number };
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "保存失败");
      return;
    }
    setMessage(`已保存 ${payload.saved ?? rows.length} 项目标`);
    window.setTimeout(() => window.location.reload(), 700);
  }

  return (
    <form className="rounded-md border border-line bg-white p-4 shadow-panel" onSubmit={submit}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">组合目标仓位</h2>
          <p className="mt-1 text-sm text-slate-600">设置资产目标和上限，页面会计算当前偏离程度。</p>
        </div>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-50" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存目标"}
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {rows.map((row, index) => (
          <div key={row.targetKey} className="rounded-md border border-line bg-paper p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-ink">{row.label}</div>
                <div className="mt-1 text-xs text-slate-500">{row.note ?? "--"}</div>
              </div>
              <span className={`rounded-md px-2 py-1 text-xs font-medium ${targetStatusClass(row.status)}`}>
                {targetStatusLabel(row.status)}
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label>
                <span className="mb-1 block text-xs text-slate-500">目标%</span>
                <input
                  className="focus-ring w-full rounded-md border border-line px-3 py-2"
                  inputMode="decimal"
                  value={row.targetWeight ?? ""}
                  onChange={(event) => update(index, "targetWeight", event.currentTarget.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs text-slate-500">上限%</span>
                <input
                  className="focus-ring w-full rounded-md border border-line px-3 py-2"
                  inputMode="decimal"
                  value={row.maxWeight ?? ""}
                  onChange={(event) => update(index, "maxWeight", event.currentTarget.value)}
                />
              </label>
              <div>
                <span className="mb-1 block text-xs text-slate-500">当前/偏离</span>
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  {formatNumber(row.currentWeight, 1)}%
                  {row.deviation !== null ? <span className="ml-2 text-slate-500">{formatNumber(row.deviation, 1)}%</span> : null}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {message ? <div className="mt-3 text-sm text-slate-600">{message}</div> : null}
    </form>
  );
}

function targetStatusLabel(value: string) {
  if (value === "over") {
    return "超上限";
  }
  if (value === "off") {
    return "偏离";
  }
  return "正常";
}

function targetStatusClass(value: string) {
  if (value === "over") {
    return "bg-coral/10 text-coral";
  }
  if (value === "off") {
    return "bg-steel/10 text-steel";
  }
  return "bg-mint/10 text-mint";
}
