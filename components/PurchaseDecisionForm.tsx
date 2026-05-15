"use client";

import { FormEvent, useRef, useState } from "react";
import { INVESTMENT_PREFERENCES_STORAGE_KEY } from "@/components/InvestmentPreferencesPanel";
import { getDecisionQueueMissingFields, normalizeInvestmentPreferences } from "@/lib/fund-ux";

export type PurchaseDecisionSettings = {
  riskProfile: "conservative" | "balanced" | "aggressive";
  plannedAmount: number;
  maxDrawdownTolerance: number;
  targetReturn: number;
  observationStatus: "researching" | "waiting_pullback" | "ready_to_buy" | "bought" | "rejected";
  buyCondition: string;
  rejectCondition: string;
  reviewDate: string;
  reviewNote: string;
};

const riskProfileOptions = [
  { value: "conservative", label: "稳健型" },
  { value: "balanced", label: "均衡型" },
  { value: "aggressive", label: "进取型" }
] as const;

const statusOptions = [
  { value: "researching", label: "待研究" },
  { value: "waiting_pullback", label: "等待回调" },
  { value: "ready_to_buy", label: "准备买入" },
  { value: "bought", label: "已买入" },
  { value: "rejected", label: "放弃" }
] as const;

function toNumber(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function PurchaseDecisionForm({
  code,
  settings,
  watched
}: {
  code: string;
  settings: PurchaseDecisionSettings;
  watched: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyGlobalPreferences() {
    const form = formRef.current;
    if (!form) {
      return;
    }
    try {
      const preferences = normalizeInvestmentPreferences(JSON.parse(window.localStorage.getItem(INVESTMENT_PREFERENCES_STORAGE_KEY) ?? "null"));
      const riskProfile = form.elements.namedItem("riskProfile") as HTMLSelectElement | null;
      const plannedAmount = form.elements.namedItem("plannedAmount") as HTMLInputElement | null;
      const maxDrawdownTolerance = form.elements.namedItem("maxDrawdownTolerance") as HTMLInputElement | null;
      const targetReturn = form.elements.namedItem("targetReturn") as HTMLInputElement | null;
      if (riskProfile) riskProfile.value = preferences.riskProfile;
      if (plannedAmount) plannedAmount.value = String(preferences.plannedAmount);
      if (maxDrawdownTolerance) maxDrawdownTolerance.value = String(preferences.maxDrawdownTolerance);
      if (targetReturn) targetReturn.value = String(preferences.targetReturn);
      setMessage("已套用全局偏好，保存后会写入本基金关注决策。");
    } catch {
      setMessage("还没有可用的全局偏好。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload: PurchaseDecisionSettings = {
      riskProfile: String(form.get("riskProfile")) as PurchaseDecisionSettings["riskProfile"],
      plannedAmount: toNumber(form.get("plannedAmount"), settings.plannedAmount),
      maxDrawdownTolerance: toNumber(form.get("maxDrawdownTolerance"), settings.maxDrawdownTolerance),
      targetReturn: Number.isFinite(Number(form.get("targetReturn"))) ? Number(form.get("targetReturn")) : settings.targetReturn,
      observationStatus: String(form.get("observationStatus")) as PurchaseDecisionSettings["observationStatus"],
      buyCondition: String(form.get("buyCondition") ?? ""),
      rejectCondition: String(form.get("rejectCondition") ?? ""),
      reviewDate: String(form.get("reviewDate") ?? ""),
      reviewNote: String(form.get("reviewNote") ?? "")
    };
    const missing = getDecisionQueueMissingFields(payload);
    if (missing.length) {
      setSaving(false);
      setMessage(`请补充${missing.join("、")}，让关注池变成可执行的决策队列。`);
      return;
    }

    const response = await fetch("/api/watchlist/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "fund",
        code,
        settings: payload
      })
    });
    const result = (await response.json()) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(result.error ?? "保存失败");
      return;
    }
    setMessage("已保存，正在按你的设置重算。");
    window.setTimeout(() => window.location.reload(), 500);
  }

  return (
    <form ref={formRef} className="rounded-md border border-line bg-white p-4 shadow-panel" onSubmit={submit}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">个性化买入设置</h2>
          <p className="mt-1 text-sm text-slate-600">
            保存后会加入关注池，并用你的金额、风险档位、买入条件和放弃条件重算购买分。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyGlobalPreferences}
            className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-xs text-slate-700"
          >
            套用全局偏好
          </button>
          <div className="rounded-md border border-line bg-paper px-3 py-2 text-xs text-slate-600">
            {watched ? "已在关注池" : "保存后加入关注池"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">风险档位</span>
          <select name="riskProfile" className="focus-ring w-full rounded-md border border-line px-3 py-2" defaultValue={settings.riskProfile}>
            {riskProfileOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">计划买入金额</span>
          <input name="plannedAmount" className="focus-ring w-full rounded-md border border-line px-3 py-2" inputMode="decimal" defaultValue={settings.plannedAmount} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">可承受回撤%</span>
          <input name="maxDrawdownTolerance" className="focus-ring w-full rounded-md border border-line px-3 py-2" inputMode="decimal" defaultValue={settings.maxDrawdownTolerance} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">目标年收益%</span>
          <input name="targetReturn" className="focus-ring w-full rounded-md border border-line px-3 py-2" inputMode="decimal" defaultValue={settings.targetReturn} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">观察状态</span>
          <select name="observationStatus" className="focus-ring w-full rounded-md border border-line px-3 py-2" defaultValue={settings.observationStatus}>
            {statusOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_160px]">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">买入条件</span>
          <input
            name="buyCondition"
            className="focus-ring w-full rounded-md border border-line px-3 py-2"
            placeholder="例如：回撤 8% 后分三批"
            defaultValue={settings.buyCondition}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">放弃条件</span>
          <input
            name="rejectCondition"
            className="focus-ring w-full rounded-md border border-line px-3 py-2"
            placeholder="例如：经理变更或同类跌出 40%"
            defaultValue={settings.rejectCondition}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">复盘日期</span>
          <input
            name="reviewDate"
            type="date"
            className="focus-ring w-full rounded-md border border-line px-3 py-2"
            defaultValue={settings.reviewDate}
          />
        </label>
      </div>

      <textarea
        name="reviewNote"
        className="focus-ring mt-3 min-h-20 w-full rounded-md border border-line px-3 py-2 text-sm"
        placeholder="记录买入理由、等待回调条件、放弃原因或复盘触发条件"
        defaultValue={settings.reviewNote}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-50" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存并重算"}
        </button>
        {message ? <span className="text-sm text-slate-600">{message}</span> : null}
      </div>
    </form>
  );
}
