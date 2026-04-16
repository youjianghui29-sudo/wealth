"use client";

import { FormEvent, useState } from "react";

export function HoldingForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    const payload = (await response.json()) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "保存失败");
      return;
    }
    window.location.reload();
  }

  return (
    <form className="rounded-md border border-line bg-white p-4 shadow-panel" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">添加或更新持仓</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-[120px_1fr_120px_120px_120px_150px]">
        <select name="targetType" className="focus-ring rounded-md border border-line px-3 py-2" defaultValue="fund">
          <option value="fund">基金</option>
          <option value="wealth">理财</option>
        </select>
        <input name="targetKey" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="基金代码或理财登记编码" required />
        <input name="shares" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="份额" inputMode="decimal" />
        <input name="costAmount" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="成本金额" inputMode="decimal" />
        <input name="costPrice" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="成本单价" inputMode="decimal" />
        <input name="purchaseDate" className="focus-ring rounded-md border border-line px-3 py-2" type="date" />
      </div>
      <textarea name="note" className="focus-ring mt-3 min-h-20 w-full rounded-md border border-line px-3 py-2" placeholder="备注：买入理由、赎回计划、风险关注点" />
      <div className="mt-3 flex items-center gap-3">
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white disabled:opacity-50" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存持仓"}
        </button>
        {message ? <span className="text-sm text-coral">{message}</span> : null}
      </div>
    </form>
  );
}

export function DeleteHoldingButton({ id }: { id: number }) {
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    await fetch("/api/portfolio", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    window.location.reload();
  }

  return (
    <button className="focus-ring rounded-md border border-line px-3 py-2 text-sm text-slate-700" type="button" onClick={remove} disabled={deleting}>
      {deleting ? "删除中" : "删除"}
    </button>
  );
}
