"use client";

import { FormEvent, useState } from "react";

export function HoldingForm({
  defaultTargetType = "fund",
  defaultTargetKey,
  defaultCostPrice
}: {
  defaultTargetType?: "fund" | "wealth";
  defaultTargetKey?: string;
  defaultCostPrice?: string;
}) {
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
        <select name="targetType" className="focus-ring rounded-md border border-line px-3 py-2" defaultValue={defaultTargetType}>
          <option value="fund">基金</option>
          <option value="wealth">理财</option>
        </select>
        <input
          name="targetKey"
          className="focus-ring rounded-md border border-line px-3 py-2"
          placeholder="基金代码或理财登记编码"
          defaultValue={defaultTargetKey}
          required
        />
        <input name="shares" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="份额" inputMode="decimal" />
        <input name="costAmount" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="成本金额" inputMode="decimal" />
        <input
          name="costPrice"
          className="focus-ring rounded-md border border-line px-3 py-2"
          placeholder="成本单价"
          inputMode="decimal"
          defaultValue={defaultCostPrice}
        />
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

export function TransactionForm({
  defaultTargetType = "fund",
  defaultTargetKey,
  defaultPrice
}: {
  defaultTargetType?: "fund" | "wealth";
  defaultTargetKey?: string;
  defaultPrice?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portfolio/transactions", {
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
      <h2 className="text-lg font-semibold text-ink">记录交易流水</h2>
      <p className="mt-1 text-sm text-slate-600">买入、卖出、现金分红和额外手续费会进入真实盈亏计算。</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[110px_1fr_120px_130px_120px_120px_120px_120px]">
        <select name="targetType" className="focus-ring rounded-md border border-line px-3 py-2" defaultValue={defaultTargetType}>
          <option value="fund">基金</option>
          <option value="wealth">理财</option>
        </select>
        <input
          name="targetKey"
          className="focus-ring rounded-md border border-line px-3 py-2"
          placeholder="基金代码或理财登记编码"
          defaultValue={defaultTargetKey}
          required
        />
        <select name="transactionType" className="focus-ring rounded-md border border-line px-3 py-2" defaultValue="buy">
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
          <option value="dividend">分红</option>
          <option value="fee">手续费</option>
        </select>
        <input name="tradeDate" className="focus-ring rounded-md border border-line px-3 py-2" type="date" required />
        <input name="shares" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="份额" inputMode="decimal" />
        <input
          name="price"
          className="focus-ring rounded-md border border-line px-3 py-2"
          placeholder="成交净值"
          inputMode="decimal"
          defaultValue={defaultPrice}
        />
        <input name="amount" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="成交金额" inputMode="decimal" />
        <input name="fee" className="focus-ring rounded-md border border-line px-3 py-2" placeholder="手续费" inputMode="decimal" />
      </div>
      <textarea name="note" className="focus-ring mt-3 min-h-16 w-full rounded-md border border-line px-3 py-2" placeholder="备注：平台、分红方式、操作原因" />
      <div className="mt-3 flex items-center gap-3">
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white disabled:opacity-50" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存流水"}
        </button>
        {message ? <span className="text-sm text-coral">{message}</span> : null}
      </div>
    </form>
  );
}

export function TransactionImportForm() {
  const fields = [
    { key: "targetType", label: "标的类型" },
    { key: "targetKey", label: "基金代码/登记编码" },
    { key: "transactionType", label: "交易类型" },
    { key: "tradeDate", label: "交易日期" },
    { key: "shares", label: "份额" },
    { key: "price", label: "成交净值" },
    { key: "amount", label: "金额" },
    { key: "fee", label: "手续费" },
    { key: "note", label: "备注" }
  ];
  const [file, setFile] = useState<File | null>(null);
  const [defaultTargetType, setDefaultTargetType] = useState<"fund" | "wealth">("fund");
  const [preview, setPreview] = useState<{
    columns: string[];
    detectedMapping: Record<string, string>;
    sampleRows: Record<string, string | null>[];
    rowCount: number;
  } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function previewFile() {
    if (!file) {
      setMessage("请先选择文件");
      return;
    }
    setPreviewing(true);
    setMessage(null);
    const form = new FormData();
    form.set("mode", "preview");
    form.set("defaultTargetType", defaultTargetType);
    form.set("file", file);
    const response = await fetch("/api/portfolio/import", {
      method: "POST",
      body: form
    });
    const payload = (await response.json()) as {
      columns?: string[];
      detectedMapping?: Record<string, string>;
      sampleRows?: Record<string, string | null>[];
      rowCount?: number;
      error?: string;
    };
    setPreviewing(false);
    if (!response.ok) {
      setMessage(payload.error ?? "预览失败");
      return;
    }
    const nextPreview = {
      columns: payload.columns ?? [],
      detectedMapping: payload.detectedMapping ?? {},
      sampleRows: payload.sampleRows ?? [],
      rowCount: payload.rowCount ?? 0
    };
    setPreview(nextPreview);
    setMapping(nextPreview.detectedMapping);
    setMessage(`识别到 ${nextPreview.rowCount} 行，请核对字段映射后导入。`);
  }

  async function importFile() {
    if (!file) {
      setMessage("请先选择文件");
      return;
    }
    setSaving(true);
    setMessage(null);
    const form = new FormData();
    form.set("mode", "import");
    form.set("defaultTargetType", defaultTargetType);
    form.set("mapping", JSON.stringify(mapping));
    form.set("file", file);
    const response = await fetch("/api/portfolio/import", {
      method: "POST",
      body: form
    });
    const payload = (await response.json()) as { inserted?: number; skipped?: number; errors?: string[]; error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "导入失败");
      return;
    }
    setMessage(`已导入 ${payload.inserted ?? 0} 条，跳过 ${payload.skipped ?? 0} 条`);
    window.setTimeout(() => window.location.reload(), 900);
  }

  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-panel">
      <h2 className="text-lg font-semibold text-ink">导入交易流水</h2>
      <p className="mt-1 text-sm text-slate-600">
        支持 CSV、TSV、Excel 文件。先预览字段映射，再确认导入，适配不同平台导出的字段名。
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_120px]">
        <select
          name="defaultTargetType"
          className="focus-ring rounded-md border border-line px-3 py-2"
          value={defaultTargetType}
          onChange={(event) => setDefaultTargetType(event.currentTarget.value === "wealth" ? "wealth" : "fund")}
        >
          <option value="fund">默认基金</option>
          <option value="wealth">默认理财</option>
        </select>
        <input
          name="file"
          className="focus-ring rounded-md border border-line px-3 py-2"
          type="file"
          accept=".csv,.tsv,.xlsx,.xls"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setPreview(null);
            setMapping({});
          }}
        />
        <button
          className="focus-ring rounded-md border border-line bg-white px-4 py-2 text-slate-700 disabled:opacity-50"
          type="button"
          onClick={previewFile}
          disabled={previewing}
        >
          {previewing ? "预览中" : "预览"}
        </button>
      </div>

      {preview ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {fields.map((field) => (
              <label key={field.key} className="text-sm">
                <span className="mb-1 block text-slate-600">{field.label}</span>
                <select
                  className="focus-ring w-full rounded-md border border-line px-3 py-2"
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.currentTarget.value }))}
                >
                  <option value="">不导入</option>
                  {preview.columns.map((column) => (
                    <option value={column} key={`${field.key}-${column}`}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="table-scroll rounded-md border border-line">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-paper text-slate-600">
                <tr>
                  {preview.columns.slice(0, 8).map((column) => (
                    <th className="px-3 py-2 font-medium" key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.sampleRows.slice(0, 5).map((row, index) => (
                  <tr key={`preview-${index}`}>
                    {preview.columns.slice(0, 8).map((column) => (
                      <td className="max-w-48 truncate px-3 py-2 text-slate-600" key={`${index}-${column}`}>{row[column] ?? "--"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="focus-ring rounded-md bg-ink px-4 py-2 text-white disabled:opacity-50"
            type="button"
            onClick={importFile}
            disabled={saving}
          >
            {saving ? "导入中" : "确认导入"}
          </button>
        </div>
      ) : null}
      {message ? <div className="mt-3 text-sm text-slate-600">{message}</div> : null}
    </section>
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

export function DeleteTransactionButton({ id }: { id: number }) {
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    await fetch("/api/portfolio/transactions", {
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
