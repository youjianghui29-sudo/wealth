"use client";

import { FormEvent, useEffect, useState } from "react";
import { normalizeInvestmentPreferences, type InvestmentPreferences } from "@/lib/fund-ux";

export const INVESTMENT_PREFERENCES_STORAGE_KEY = "wealth.investment.preferences";

const riskProfileOptions = [
  { value: "conservative", label: "稳健型" },
  { value: "balanced", label: "均衡型" },
  { value: "aggressive", label: "进取型" }
] as const;

function readPreferences() {
  if (typeof window === "undefined") {
    return normalizeInvestmentPreferences(null);
  }
  try {
    return normalizeInvestmentPreferences(JSON.parse(window.localStorage.getItem(INVESTMENT_PREFERENCES_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeInvestmentPreferences(null);
  }
}

export function InvestmentPreferencesPanel() {
  const [preferences, setPreferences] = useState<InvestmentPreferences>(() => normalizeInvestmentPreferences(null));
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPreferences(readPreferences());
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = normalizeInvestmentPreferences({
      riskProfile: String(form.get("riskProfile")) as InvestmentPreferences["riskProfile"],
      plannedAmount: Number(form.get("plannedAmount")),
      maxDrawdownTolerance: Number(form.get("maxDrawdownTolerance")),
      targetReturn: Number(form.get("targetReturn")),
      maxPositionWeight: Number(form.get("maxPositionWeight"))
    });
    window.localStorage.setItem(INVESTMENT_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    setPreferences(next);
    setMessage("已保存，基金详情页可直接套用。");
  }

  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">全局投资偏好</h2>
          <p className="mt-1 text-sm text-slate-600">先固定自己的风险档位、单笔金额、回撤上限和目标收益，后续研究基金时直接套用。</p>
        </div>
        <div className="rounded-md border border-line bg-paper px-3 py-2 text-xs text-slate-600">
          当前：{preferences.riskProfile === "conservative" ? "稳健型" : preferences.riskProfile === "aggressive" ? "进取型" : "均衡型"} · ¥
          {preferences.plannedAmount.toLocaleString("zh-CN")} · 回撤 {preferences.maxDrawdownTolerance}%
        </div>
      </div>
      <form className="mt-4 grid gap-3 md:grid-cols-6" onSubmit={submit} key={JSON.stringify(preferences)}>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">风险档位</span>
          <select name="riskProfile" className="focus-ring w-full rounded-md border border-line px-3 py-2" defaultValue={preferences.riskProfile}>
            {riskProfileOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">计划金额</span>
          <input name="plannedAmount" className="focus-ring w-full rounded-md border border-line px-3 py-2" inputMode="decimal" defaultValue={preferences.plannedAmount} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">回撤上限%</span>
          <input
            name="maxDrawdownTolerance"
            className="focus-ring w-full rounded-md border border-line px-3 py-2"
            inputMode="decimal"
            defaultValue={preferences.maxDrawdownTolerance}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">目标收益%</span>
          <input name="targetReturn" className="focus-ring w-full rounded-md border border-line px-3 py-2" inputMode="decimal" defaultValue={preferences.targetReturn} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">单仓上限%</span>
          <input
            name="maxPositionWeight"
            className="focus-ring w-full rounded-md border border-line px-3 py-2"
            inputMode="decimal"
            defaultValue={preferences.maxPositionWeight}
          />
        </label>
        <div className="flex items-end">
          <button type="submit" className="focus-ring w-full rounded-md bg-ink px-4 py-2 text-sm text-white">
            保存偏好
          </button>
        </div>
      </form>
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}
