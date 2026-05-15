import { buildDailyBriefPreview, findLatestDailyBrief } from "@/lib/daily-brief";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function DailyBriefPage() {
  const brief = findLatestDailyBrief();
  const preview = brief ? buildDailyBriefPreview(brief.content, 12) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">每日简报</h1>
        <p className="mt-2 text-sm text-slate-600">汇总持仓、关注池、候选基金、数据缺口和需要处理的事项。</p>
      </div>

      {!brief ? (
        <section className="rounded-md border border-dashed border-line bg-white p-6 text-sm leading-7 text-slate-600">
          <div className="font-medium text-ink">还没有生成简报</div>
          <p className="mt-2">运行下面的命令后，页面会读取 `data/reports` 下最新的 markdown 简报。</p>
          <code className="mt-3 block rounded-md bg-paper px-3 py-2 text-xs text-ink">
            python scripts/generate_fund_daily_brief.py
          </code>
        </section>
      ) : (
        <>
          <section className="rounded-md border border-line bg-white p-4 shadow-panel">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">{brief.fileName}</h2>
                <p className="mt-1 text-sm text-slate-600">更新时间：{formatDateTime(brief.updatedAt)}</p>
              </div>
              <span className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-slate-600">
                {preview?.truncated ? "已截取摘要" : "完整摘要"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              {preview?.lines.map((line, index) => (
                <div key={`${index}-${line}`} className="rounded-md border border-line bg-paper px-3 py-2 text-slate-700">
                  {line}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4 shadow-panel">
            <h2 className="text-lg font-semibold text-ink">完整内容</h2>
            <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-paper p-4 text-sm leading-7 text-slate-700">
              {brief.content}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
