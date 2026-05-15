"use client";

import { FormEvent, useMemo, useState } from "react";

type AlertRule = {
  id: number;
  metric: string;
  threshold: number | null;
  enabled: boolean;
  note: string | null;
};

const metricOptions = [
  { value: "daily_drop", label: "单日跌幅", threshold: "3", suffix: "%", helper: "净值日跌幅达到阈值时提醒" },
  { value: "take_profit", label: "止盈线", threshold: "12", suffix: "%", helper: "持仓收益达到目标时提醒" },
  { value: "peer_below", label: "同类跌出", threshold: "40", suffix: "%", helper: "近 1 年同类百分位低于阈值时提醒" },
  { value: "position_over", label: "仓位超限", threshold: "25", suffix: "%", helper: "组合占比超过上限时提醒" },
  { value: "manager_change", label: "公告变更", threshold: "", suffix: "", helper: "出现经理、清盘、暂停等高影响公告时提醒" }
];

function metricLabel(metric: string) {
  return metricOptions.find((item) => item.value === metric)?.label ?? metric;
}

export function AlertRuleForm({
  targetType,
  targetKey,
  initialRules,
  defaults
}: {
  targetType: "fund" | "wealth";
  targetKey: string;
  initialRules: AlertRule[];
  defaults?: {
    targetReturn?: number;
    maxPositionWeight?: number;
  };
}) {
  const [metric, setMetric] = useState(metricOptions[0].value);
  const [threshold, setThreshold] = useState(metricOptions[0].threshold);
  const [note, setNote] = useState("");
  const [rules, setRules] = useState(initialRules);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => metricOptions.find((item) => item.value === metric) ?? metricOptions[0], [metric]);
  const needsThreshold = metric !== "manager_change";

  function changeMetric(value: string) {
    setMetric(value);
    const option = metricOptions.find((item) => item.value === value) ?? metricOptions[0];
    if (value === "take_profit" && defaults?.targetReturn) {
      setThreshold(String(defaults.targetReturn));
    } else if (value === "position_over" && defaults?.maxPositionWeight) {
      setThreshold(String(defaults.maxPositionWeight));
    } else {
      setThreshold(option.threshold);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetKey,
        metric,
        threshold: needsThreshold ? Number(threshold) : null,
        note
      })
    });
    const payload = (await response.json()) as { rule?: AlertRule; error?: string };
    setSaving(false);
    if (!response.ok || !payload.rule) {
      setMessage(payload.error ?? "保存失败");
      return;
    }
    setRules((current) => [payload.rule as AlertRule, ...current].slice(0, 8));
    setNote("");
    setMessage("已保存，预警中心会按这条规则触发提醒。");
  }

  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">自定义提醒</h2>
          <p className="mt-1 text-sm text-slate-600">把止盈、跌幅、同类排名、仓位和公告变更设置成可执行规则。</p>
        </div>
        <span className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-slate-600">已启用 {rules.filter((item) => item.enabled).length} 条</span>
      </div>

      <form className="mt-4 grid gap-3 lg:grid-cols-[180px_140px_1fr_110px]" onSubmit={submit}>
        <select
          className="focus-ring rounded-md border border-line px-3 py-2 text-sm"
          value={metric}
          onChange={(event) => changeMetric(event.currentTarget.value)}
        >
          {metricOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-line bg-white">
          <input
            className="focus-ring min-w-0 flex-1 rounded-l-md px-3 py-2 text-sm disabled:bg-paper"
            value={threshold}
            onChange={(event) => setThreshold(event.currentTarget.value)}
            inputMode="decimal"
            disabled={!needsThreshold}
            aria-label="提醒阈值"
          />
          <span className="flex items-center border-l border-line px-2 text-sm text-slate-500">{selected.suffix || "--"}</span>
        </div>
        <input
          className="focus-ring rounded-md border border-line px-3 py-2 text-sm"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          placeholder={selected.helper}
        />
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存规则"}
        </button>
      </form>
      {message ? <div className="mt-3 text-sm text-slate-600">{message}</div> : null}

      <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
        {rules.length === 0 ? (
          <div className="rounded-md border border-line bg-paper px-3 py-2 text-slate-500">暂无自定义提醒。</div>
        ) : (
          rules.slice(0, 6).map((rule) => (
            <div key={rule.id} className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{metricLabel(rule.metric)}</span>
                <span className="text-xs text-slate-500">{rule.enabled ? "启用" : "停用"}</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {rule.threshold === null ? "无固定阈值" : `阈值 ${rule.threshold}%`}
                {rule.note ? ` · ${rule.note}` : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
