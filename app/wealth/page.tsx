import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { TrendBadge } from "@/components/TrendBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { getWealthProductList } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WealthPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = {
    q: single(rawParams.q),
    issuer: single(rawParams.issuer),
    riskLevel: single(rawParams.riskLevel),
    operationMode: single(rawParams.operationMode),
    direction: single(rawParams.direction),
    sort: single(rawParams.sort),
    page: single(rawParams.page)
  };
  const result = await getWealthProductList(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">银行理财</h1>
        <p className="mt-2 text-sm text-slate-600">
          展示公开披露产品、最新净值和可计算的净值变化；无法取得历史净值时显示暂无涨跌。
        </p>
      </div>

      <form className="grid gap-3 rounded-md border border-line bg-white p-4 shadow-panel md:grid-cols-[1fr_160px_120px_150px_140px_140px_100px]">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="搜索产品名称或登记编码"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <input
          name="issuer"
          defaultValue={params.issuer}
          placeholder="发行机构"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select
          name="riskLevel"
          defaultValue={params.riskLevel ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">全部风险</option>
          <option value="R1">R1</option>
          <option value="R2">R2</option>
          <option value="R3">R3</option>
          <option value="R4">R4</option>
          <option value="R5">R5</option>
        </select>
        <input
          name="operationMode"
          defaultValue={params.operationMode}
          placeholder="开放式/封闭式"
          className="focus-ring rounded-md border border-line px-3 py-2"
        />
        <select
          name="direction"
          defaultValue={params.direction ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">全部涨跌</option>
          <option value="up">上涨</option>
          <option value="down">下跌</option>
          <option value="flat">平盘</option>
        </select>
        <select
          name="sort"
          defaultValue={params.sort ?? ""}
          className="focus-ring rounded-md border border-line px-3 py-2"
        >
          <option value="">最新披露</option>
          <option value="change_asc">跌幅优先</option>
          <option value="name">名称排序</option>
        </select>
        <button className="focus-ring rounded-md bg-ink px-4 py-2 text-white" type="submit">
          筛选
        </button>
      </form>

      <div className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 text-sm text-slate-600">
          共 {result.total} 款理财产品
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">产品</th>
                <th className="px-4 py-3 font-medium">发行机构</th>
                <th className="px-4 py-3 font-medium">风险</th>
                <th className="px-4 py-3 font-medium">运作模式</th>
                <th className="px-4 py-3 text-right font-medium">最新净值</th>
                <th className="px-4 py-3 text-right font-medium">净值变化</th>
                <th className="px-4 py-3 font-medium">净值日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((row) => (
                <tr key={row.registerCode} className="hover:bg-paper/70">
                  <td className="px-4 py-3">
                    <Link
                      href={`/wealth/${encodeURIComponent(row.registerCode)}`}
                      className="focus-ring rounded font-medium text-ink"
                    >
                      {row.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">{row.registerCode}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.issuer ?? "--"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.riskLevel ?? "--"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.operationMode ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.netValue)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={row.dailyChangeRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.navDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        searchParams={{
          q: params.q,
          issuer: params.issuer,
          riskLevel: params.riskLevel,
          operationMode: params.operationMode,
          direction: params.direction,
          sort: params.sort
        }}
      />
    </div>
  );
}
