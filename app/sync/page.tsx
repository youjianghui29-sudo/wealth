import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const jobs = await prisma.syncJob.findMany({
    orderBy: {
      startedAt: "desc"
    },
    take: 30
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">采集状态</h1>
        <p className="mt-2 text-sm text-slate-600">
          每日任务计划在 22:30 运行。部分数据源失败时保留旧数据，并在此处记录失败原因。
        </p>
      </div>

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
                    <td className="px-4 py-3 text-right">{job.fundRows}</td>
                    <td className="px-4 py-3 text-right">{job.wealthRows}</td>
                    <td className="px-4 py-3 text-right">{job.announcementRows}</td>
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
