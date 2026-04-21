"use client";

import { useState } from "react";

type BackfillAction = "fund_full" | "fund_history" | "fund_profile" | "portfolio" | "watchlist" | "priority" | "profile_batches";

export function BackfillButton({
  action,
  code,
  label,
  historyDays = 756,
  className
}: {
  action: BackfillAction;
  code?: string;
  label: string;
  historyDays?: number;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setState("running");
    setMessage(null);
    const response = await fetch("/api/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, code, historyDays })
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "启动失败");
      return;
    }
    setState("done");
    setMessage("已启动，稍后看数据页状态");
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className={
          className ??
          "focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
        }
        type="button"
        onClick={start}
        disabled={state === "running"}
      >
        {state === "running" ? "启动中" : label}
      </button>
      {message ? (
        <span className={`text-xs ${state === "error" ? "text-coral" : "text-slate-500"}`}>{message}</span>
      ) : null}
    </span>
  );
}
