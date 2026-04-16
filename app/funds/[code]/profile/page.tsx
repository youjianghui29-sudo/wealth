import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
};

export default async function FundProfilePage({ params }: PageProps) {
  const { code } = await params;
  const fund = await getFundProfile(decodeURIComponent(code));

  if (!fund) {
    notFound();
  }

  const profile = fund.profile;
  const latestHoldingPeriod = fund.holdings[0]?.reportPeriod;
  const holdings = latestHoldingPeriod
    ? fund.holdings.filter((item) => item.reportPeriod === latestHoldingPeriod).slice(0, 20)
    : [];
  const latestBondPeriod = fund.bondHoldings[0]?.reportPeriod;
  const bonds = latestBondPeriod
    ? fund.bondHoldings.filter((item) => item.reportPeriod === latestBondPeriod).slice(0, 20)
    : [];
  const latestChangeYear = fund.portfolioChanges[0]?.reportYear;
  const changes = latestChangeYear
    ? fund.portfolioChanges.filter((item) => item.reportYear === latestChangeYear).slice(0, 30)
    : [];
  const latestIndustryDate = fund.industries[0]?.reportDate;
  const industries = latestIndustryDate
    ? fund.industries.filter((item) => String(item.reportDate) === String(latestIndustryDate)).slice(0, 20)
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{fund.code}</p>
          <h1 className="text-2xl font-semibold text-ink">{fund.name} 基金资料</h1>
          <p className="mt-2 text-sm text-slate-600">
            经理、规模、交易费率、股票持仓、行业配置和公告集中展示。
          </p>
        </div>
        <Link href={`/funds/${encodeURIComponent(fund.code)}`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
          返回详情
        </Link>
      </div>

      {!profile ? (
        <section className="rounded-md border border-dashed border-line bg-white p-6 text-sm leading-7 text-slate-600">
          暂无基金资料。运行真实采集时设置 FUND_PROFILE_LIMIT 可增加资料采集数量。
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Info label="基金经理" value={profile.managerNames ?? "--"} />
          <Info label="最新规模" value={profile.latestScale ?? "--"} />
          <Info label="基金公司" value={profile.fundCompany ?? "--"} />
          <Info label="成立时间" value={formatDate(profile.inceptionDate)} />
        </section>
      )}

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold text-ink">基本资料</h2>
        <div className="mt-4 grid gap-4 text-sm leading-7 md:grid-cols-2">
          <Field label="基金全称" value={profile?.fullName} />
          <Field label="托管银行" value={profile?.custodianBank} />
          <Field label="基金类型" value={profile?.fundTypeDetail ?? fund.fundType} />
          <Field label="评级" value={profile?.rating} />
          <Field label="业绩比较基准" value={profile?.benchmark} wide />
          <Field label="投资目标" value={profile?.investmentObjective} wide />
          <Field label="投资策略" value={profile?.investmentStrategy} wide />
        </div>
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">交易费率</h2>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">费用类型</th>
                <th className="px-4 py-3 font-medium">条件或名称</th>
                <th className="px-4 py-3 text-right font-medium">费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fund.fees.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    暂无费率数据
                  </td>
                </tr>
              ) : (
                fund.fees.map((fee) => (
                  <tr key={fee.id}>
                    <td className="px-4 py-3">{fee.feeType}</td>
                    <td className="px-4 py-3 text-slate-600">{fee.conditionName}</td>
                    <td className="px-4 py-3 text-right">{fee.feeValue ?? "--"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DataTable
          title={`股票持仓${latestHoldingPeriod ? ` · ${latestHoldingPeriod}` : ""}`}
          empty="暂无持仓数据"
          headers={["股票", "占净值比例", "持股数", "持仓市值"]}
          rows={holdings.map((item) => [
            `${item.stockName} ${item.stockCode}`,
            formatNumber(item.ratio, 2),
            formatNumber(item.shares, 2),
            formatNumber(item.marketValue, 2)
          ])}
        />
        <DataTable
          title={`债券持仓${latestBondPeriod ? ` · ${latestBondPeriod}` : ""}`}
          empty="暂无债券持仓"
          headers={["债券", "占净值比例", "持仓市值"]}
          rows={bonds.map((item) => [
            `${item.bondName} ${item.bondCode}`,
            formatNumber(item.ratio, 2),
            formatNumber(item.marketValue, 2)
          ])}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DataTable
          title={`行业配置${latestIndustryDate ? ` · ${formatDate(latestIndustryDate)}` : ""}`}
          empty="暂无行业配置"
          headers={["行业", "占净值比例", "市值"]}
          rows={industries.map((item) => [
            item.industryName,
            formatNumber(item.ratio, 2),
            formatNumber(item.marketValue, 2)
          ])}
        />
        <DataTable
          title={`重大买卖${latestChangeYear ? ` · ${latestChangeYear}` : ""}`}
          empty="暂无重大买卖"
          headers={["类型", "股票", "金额", "占比"]}
          rows={changes.map((item) => [
            item.changeType,
            `${item.stockName} ${item.stockCode}`,
            formatNumber(item.amount, 2),
            formatNumber(item.ratio, 2)
          ])}
        />
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <h2 className="font-semibold text-ink">公告</h2>
        <div className="mt-3 divide-y divide-line">
          {fund.announcements.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">暂无公告</p>
          ) : (
            fund.announcements.map((item) => (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring block rounded py-3 text-sm"
                key={item.id}
              >
                <span className="block font-medium text-ink">{item.title}</span>
                <span className="mt-1 block text-slate-500">
                  {item.source} · {formatDate(item.publishedAt)}
                </span>
              </a>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function Field({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="font-medium text-ink">{label}</div>
      <div className="mt-1 text-slate-600">{value || "--"}</div>
    </div>
  );
}

function DataTable({
  title,
  empty,
  headers,
  rows
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="rounded-md border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      <div className="table-scroll">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-paper text-slate-600">
            <tr>
              {headers.map((header) => (
                <th className="px-4 py-3 font-medium" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-4 py-6 text-center text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td className={`px-4 py-3 ${cellIndex > 0 ? "text-right" : ""}`} key={`${cell}-${cellIndex}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
