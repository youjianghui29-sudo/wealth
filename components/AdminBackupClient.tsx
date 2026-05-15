"use client";

import { useState } from "react";

type Backup = {
  fileName: string;
  size: number;
  createdAt: string | Date;
};

export function AdminBackupClient({ initialBackups }: { initialBackups: Backup[] }) {
  const [backups, setBackups] = useState(initialBackups);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/backups");
    const payload = (await response.json()) as { backups?: Backup[] };
    setBackups(payload.backups ?? []);
  }

  async function createBackup() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "backup" })
    });
    const payload = (await response.json()) as { error?: string; backup?: Backup };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "备份失败");
      return;
    }
    setMessage(`已创建备份：${payload.backup?.fileName ?? ""}`);
    await refresh();
  }

  async function restoreBackup(fileName: string) {
    if (!window.confirm(`确认恢复 ${fileName}？恢复前会自动再备份当前数据库。`)) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", fileName })
    });
    const payload = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "恢复失败");
      return;
    }
    setMessage("恢复完成，建议刷新页面重新读取数据。");
    await refresh();
  }

  return (
    <div className="space-y-4">
      <button className="focus-ring rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-60" type="button" onClick={createBackup} disabled={busy}>
        {busy ? "处理中" : "创建数据库备份"}
      </button>
      {message ? <div className="text-sm text-slate-600">{message}</div> : null}
      <div className="divide-y divide-line rounded-md border border-line bg-white">
        {backups.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">暂无备份。</div>
        ) : (
          backups.map((backup) => (
            <div key={backup.fileName} className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-ink">{backup.fileName}</div>
                <div className="mt-1 text-xs text-slate-500">{Number(backup.size / 1024 / 1024).toFixed(1)} MB</div>
              </div>
              <button className="focus-ring rounded-md border border-line bg-paper px-3 py-2 text-xs text-slate-700" type="button" onClick={() => restoreBackup(backup.fileName)} disabled={busy}>
                恢复
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
