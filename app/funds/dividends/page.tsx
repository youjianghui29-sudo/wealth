import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundDividends } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DividendRow = {
  id: number;
  fundCode: string | null;
  fundName: string | null;
  dividendType: string;
  registrationDate: Date | string | null;
  exDividendDate: Date | string | null;
  paymentDate: Date | string | null;
  dividendPerShare: number | null;
  dividendPer10: number | null;
  cumulativeDividend: number | null;
  cumulativeCount: number | null;
  announcementTitle: string | null;
  announcementUrl: string | null;
  fund?: { name: string | null } | null;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FundDividendsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = {
    q: single(raw.q),
    dividendType: single(raw.dividendType),
    page: single(raw.page)
  };
  const result = await getFundDividends(params);
  const items = result.items as DividendRow[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">分红配送</h1>
        <p className="mt-2 text-sm text-slate-600">查看基金分红公告、分红历史与 ETF 分红记录。</p>
      </div>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_240px_100px]">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="搜索基金、代码或公告标题"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <input
          name="dividendType"
          defaultValue={params.dividendType}
          placeholder="筛选分红类型，如现金分红"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">共 {result.total} 条分红记录</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">登记日</th>
                <th className="px-4 py-3 font-medium">除息日</th>
                <th className="px-4 py-3 font-medium">发放日</th>
                <th className="px-4 py-3 text-right font-medium">每份分红</th>
                <th className="px-4 py-3 text-right font-medium">每10份分红</th>
                <th className="px-4 py-3 text-right font-medium">累计分红</th>
                <th className="px-4 py-3 text-right font-medium">累计次数</th>
                <th className="px-4 py-3 font-medium">公告</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                    暂无匹配分红记录
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
                        {row.fund?.name ?? row.fundName ?? row.fundCode ?? "--"}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{row.fundCode ?? "--"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.dividendType}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(row.registrationDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(row.exDividendDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(row.paymentDate)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(row.dividendPerShare, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(row.dividendPer10, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(row.cumulativeDividend, 4)}</td>
                    <td className="px-4 py-3 text-right">{row.cumulativeCount ?? "--"}</td>
                    <td className="px-4 py-3">
                      {row.announcementUrl ? (
                        <a
                          href={row.announcementUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring rounded text-steel underline decoration-line underline-offset-2"
                        >
                          {row.announcementTitle ?? "打开"}
                        </a>
                      ) : (
                        <span className="text-slate-500">--</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={result.page} pageCount={result.pageCount} searchParams={{ q: params.q, dividendType: params.dividendType }} />
    </div>
  );
}
