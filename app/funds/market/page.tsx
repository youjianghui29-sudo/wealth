import { formatDate, formatNumber } from "@/lib/format";
import { getFundMarketStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FundMarketPage() {
  const { scales, holders } = await getFundMarketStats();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">规模与持有人结构</h1>
        <p className="mt-2 text-sm text-slate-600">展示全市场基金规模份额变化和持有人结构。</p>
      </div>
      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 font-semibold text-ink">规模变动</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">截止日期</th>
                <th className="px-4 py-3 text-right font-medium">基金家数</th>
                <th className="px-4 py-3 text-right font-medium">期间申购</th>
                <th className="px-4 py-3 text-right font-medium">期间赎回</th>
                <th className="px-4 py-3 text-right font-medium">期末总份额</th>
                <th className="px-4 py-3 text-right font-medium">期末净资产</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {scales.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">{formatDate(row.reportDate)}</td>
                  <td className="px-4 py-3 text-right">{row.fundCount ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.purchaseAmount, 2)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.redeemAmount, 2)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.totalShare, 2)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.netAsset, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3 font-semibold text-ink">持有人结构</div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">截止日期</th>
                <th className="px-4 py-3 text-right font-medium">基金家数</th>
                <th className="px-4 py-3 text-right font-medium">机构持有比例</th>
                <th className="px-4 py-3 text-right font-medium">个人持有比例</th>
                <th className="px-4 py-3 text-right font-medium">内部持有比例</th>
                <th className="px-4 py-3 text-right font-medium">总份额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {holders.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">{formatDate(row.reportDate)}</td>
                  <td className="px-4 py-3 text-right">{row.fundCount ?? "--"}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.institutionRatio, 2)}%</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.individualRatio, 2)}%</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.internalRatio, 2)}%</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.totalShare, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
