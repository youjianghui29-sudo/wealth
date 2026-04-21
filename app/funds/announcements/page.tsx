import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import { getFundAnnouncements } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AnnouncementRow = {
  id: number;
  fundCode: string | null;
  title: string;
  source: string | null;
  publishedAt: Date | string | null;
  url: string;
  impact?: { level: string; label: string; reason: string };
  fund?: { name: string | null } | null;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function sourceLabel(source: string | null | undefined) {
  if (source === "akshare-report") return "定期报告";
  if (source === "akshare-dividend") return "分红公告";
  if (source === "akshare-personnel") return "人事调整";
  return source ?? "--";
}

function impactClass(level: string | undefined) {
  if (level === "high") return "bg-coral/10 text-coral";
  if (level === "medium") return "bg-steel/10 text-steel";
  return "bg-mint/10 text-mint";
}

export default async function FundAnnouncementsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = {
    q: single(raw.q),
    source: single(raw.source),
    page: single(raw.page)
  };
  const result = await getFundAnnouncements(params);
  const items = result.items as AnnouncementRow[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">基金公告中心</h1>
        <p className="mt-2 text-sm text-slate-600">按公告类型和影响级别查看基金公告，高影响公告优先核对交易、费率、经理和产品存续。</p>
      </div>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_200px_100px]">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="搜索基金、标题或代码"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select name="source" defaultValue={params.source ?? ""} className="focus-ring rounded-md border border-line px-3 py-2">
          <option value="">全部类型</option>
          <option value="report">定期报告</option>
          <option value="dividend">分红公告</option>
          <option value="personnel">人事调整</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 条公告</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">影响</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 font-medium">链接</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    暂无匹配公告
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/funds/${encodeURIComponent(row.fundCode ?? "")}`}
                        className="focus-ring rounded font-medium text-ink"
                      >
                        {row.fund?.name ?? row.fundCode ?? "--"}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{row.fundCode ?? "--"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.title}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-1 text-xs font-medium ${impactClass(row.impact?.level)}`}>
                        {row.impact?.label ?? "低影响"}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{row.impact?.reason ?? "普通公告"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{sourceLabel(row.source)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(row.publishedAt)}</td>
                    <td className="px-4 py-3">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring rounded text-steel underline decoration-line underline-offset-2"
                      >
                        打开
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={result.page} pageCount={result.pageCount} searchParams={{ q: params.q, source: params.source }} />
    </div>
  );
}
