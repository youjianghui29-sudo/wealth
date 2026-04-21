import { formatDate, formatDateTime } from "@/lib/format";
import { BackfillButton } from "@/components/BackfillButton";
import { getDataCoverage, getRecentSyncJobs } from "@/lib/queries";

export const dynamic = "force-dynamic";

function statusClass(status: string) {
  if (status === "good") {
    return "bg-mint/10 text-mint";
  }
  if (status === "warn") {
    return "bg-steel/10 text-steel";
  }
  return "bg-coral/10 text-coral";
}

function statusLabel(status: string) {
  if (status === "good") {
    return "较完整";
  }
  if (status === "warn") {
    return "需补充";
  }
  return "缺口大";
}

function jobStatusClass(status: string) {
  if (status === "running") {
    return "bg-steel/10 text-steel";
  }
  if (status === "success") {
    return "bg-mint/10 text-mint";
  }
  if (status === "partial") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-coral/10 text-coral";
}

function jobStatusLabel(status: string) {
  if (status === "running") return "运行中";
  if (status === "success") return "成功";
  if (status === "partial") return "部分成功";
  return "失败";
}

function parseBatchProgress(message: string | null | undefined) {
  const text = message ?? "";
  const matches = [...text.matchAll(/(history|profile) batch (\d+)\/(\d+) size=(\d+) (?:rows|profiles)=(\d+) total=(\d+)/g)];
  const latest = matches.at(-1);
  if (!latest) {
    return null;
  }
  const current = Number(latest[2]);
  const total = Number(latest[3]);
  return {
    phase: latest[1] === "history" ? "历史净值" : "基金画像",
    current,
    total,
    batchSize: Number(latest[4]),
    rows: Number(latest[5]),
    cumulative: Number(latest[6]),
    percent: total > 0 ? (current / total) * 100 : 0
  };
}

function parseJobIssueList(job: { failedSources: string | null; message: string | null }) {
  const items = new Set<string>();
  if (job.failedSources) {
    for (const item of job.failedSources.split(",")) {
      if (item.trim()) items.add(item.trim());
    }
  }
  const text = job.message ?? "";
  for (const match of text.matchAll(/([a-zA-Z0-9_]+(?: batch \d+\/\d+)?) failed: ([^;]+)/g)) {
    items.add(`${match[1]}: ${match[2].slice(0, 120)}`);
  }
  for (const match of text.matchAll(/batch_(\d+)_(timeout|failed)/g)) {
    items.add(`batch ${match[1]} ${match[2]}`);
  }
  return Array.from(items).slice(0, 8);
}

export default async function SyncPage() {
  const [jobs, coverage] = await Promise.all([
    getRecentSyncJobs(30),
    getDataCoverage()
  ]);
  const runningJobs = jobs.filter((job) => job.status === "running");
  const failedJobs = jobs.filter((job) => job.status === "failed" || job.status === "partial");
  const completedJobs = jobs.filter((job) => job.status === "success");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">数据与采集</h1>
        <p className="mt-2 text-sm text-slate-600">
          查看每日任务、数据覆盖率和补全缺口。部分数据源失败时保留旧数据，并在此处记录失败原因。
        </p>
      </div>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">补数任务中心</h2>
            <p className="mt-1 text-sm text-slate-600">查看后台补数是否运行、最近失败原因和已完成任务。运行中的任务会持续更新说明字段。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="font-semibold text-ink">{runningJobs.length}</div>
              <div className="text-xs text-slate-500">运行中</div>
            </div>
            <div className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="font-semibold text-ink">{failedJobs.length}</div>
              <div className="text-xs text-slate-500">需处理</div>
            </div>
            <div className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="font-semibold text-ink">{completedJobs.length}</div>
              <div className="text-xs text-slate-500">已完成</div>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {(runningJobs.length ? runningJobs : jobs.slice(0, 1)).map((job) => {
            const progress = parseBatchProgress(job.message);
            const issues = parseJobIssueList(job);
            return (
            <div key={`task-${job.id}`} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-ink">{job.jobType}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(job.startedAt)}</div>
                </div>
                <span className={`rounded-md px-2 py-1 text-xs font-medium ${jobStatusClass(job.status)}`}>
                  {jobStatusLabel(job.status)}
                </span>
              </div>
              <p className="mt-3 line-clamp-4 text-slate-600">{job.failedSources ? `失败源：${job.failedSources}` : job.message ?? "等待任务写入进度"}</p>
              {progress ? (
                <div className="mt-3 rounded-md border border-line bg-white p-2">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>{progress.phase}</span>
                    <span>{progress.current}/{progress.total}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-md bg-paper">
                    <div className="h-full rounded-md bg-steel" style={{ width: `${Math.max(3, Math.min(100, progress.percent))}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    本批写入 {progress.rows.toLocaleString("zh-CN")}，累计 {progress.cumulative.toLocaleString("zh-CN")}
                  </div>
                </div>
              ) : null}
              {issues.length ? (
                <ul className="mt-3 list-inside list-disc text-xs text-coral">
                  {issues.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            );
          })}
          {failedJobs.slice(0, 2).map((job) => (
            <div key={`failed-${job.id}`} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="font-medium text-ink">{job.jobType}</div>
              <div className="mt-1 text-xs text-slate-500">{formatDateTime(job.finishedAt)}</div>
              <p className="mt-3 line-clamp-4 text-slate-600">{job.failedSources ? `失败源：${job.failedSources}` : job.message ?? "--"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {coverage.metrics.map((metric) => (
          <div key={metric.key} className="rounded-md border border-line bg-white p-4 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">{metric.label}</h2>
                <p className="mt-1 text-xs text-slate-500">{metric.note}</p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${statusClass(metric.status)}`}>
                {statusLabel(metric.status)}
              </span>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="text-2xl font-semibold text-ink">{metric.value.toLocaleString("zh-CN")}</div>
              <div className="text-right text-xs text-slate-500">
                {metric.total ? (
                  <>
                    <div>目标 {metric.total.toLocaleString("zh-CN")}</div>
                    <div>{metric.ratio?.toFixed(1)}%</div>
                  </>
                ) : (
                  <div>可用记录</div>
                )}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-md bg-paper">
              <div
                className={`h-full rounded-md ${
                  metric.status === "good" ? "bg-mint" : metric.status === "warn" ? "bg-steel" : "bg-coral"
                }`}
                style={{ width: `${Math.max(3, Math.min(100, metric.ratio ?? (metric.value > 0 ? 100 : 0)))}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-slate-500">最新日期：{formatDate(metric.latestDate)}</div>
          </div>
        ))}
      </section>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600 shadow-panel">
        <h2 className="mb-2 font-semibold text-ink">补全建议</h2>
        <p>
          当前基金总数 {coverage.fundTotal.toLocaleString("zh-CN")}，有任意净值记录{" "}
          {coverage.fundWithAnyNav.toLocaleString("zh-CN")}；理财公开样本 {coverage.wealthTotal.toLocaleString("zh-CN")}。
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          {coverage.recommendations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <BackfillButton action="portfolio" label="一键补持仓数据" />
          <BackfillButton action="watchlist" label="一键补关注池" />
          <BackfillButton action="priority" label="一键补优先缺口" />
          <BackfillButton action="profile_batches" label="分批补全画像" />
        </div>
      </section>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">任务</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">开始</th>
                <th className="px-4 py-3 font-medium">结束</th>
                <th className="px-4 py-3 text-right font-medium">基金</th>
                <th className="px-4 py-3 text-right font-medium">理财</th>
                <th className="px-4 py-3 text-right font-medium">公告</th>
                <th className="px-4 py-3 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    暂无采集记录
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3">{job.jobType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          job.status === "success"
                            ? "bg-mint/10 text-mint"
                            : job.status === "partial"
                              ? "bg-steel/10 text-steel"
                              : "bg-coral/10 text-coral"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(job.startedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(job.finishedAt)}</td>
                    <td className="px-4 py-3 text-right">{job.fundRows ?? 0}</td>
                    <td className="px-4 py-3 text-right">{job.wealthRows ?? 0}</td>
                    <td className="px-4 py-3 text-right">{job.announcementRows ?? 0}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {job.failedSources ? `失败源：${job.failedSources}` : job.message ?? "--"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600 shadow-panel">
        <h2 className="mb-2 font-semibold text-ink">本地定时任务</h2>
        <p>手动采集：npm run collect</p>
        <p>演示数据：npm run collect:seed</p>
        <p>Windows 计划任务命令：python scripts/collector/run_daily.py</p>
      </section>
    </div>
  );
}
