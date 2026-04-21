import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { BackfillButton } from "@/components/BackfillButton";
import { AddCompareButton } from "@/components/CompareTray";
import { NavChart } from "@/components/NavChart";
import { TrendBadge } from "@/components/TrendBadge";
import { WatchButton } from "@/components/WatchButton";
import { formatDate, formatNumber } from "@/lib/format";
import { getFundDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
};

function isOpenForPurchase(status: string | null | undefined) {
  if (!status) {
    return false;
  }
  const normalized = status.replace(/\s/g, "");
  return (
    (normalized.includes("开放") || normalized.includes("申购")) &&
    !/(暂停|封闭|停止|不可|限制)/.test(normalized)
  );
}

export default async function FundDetailPage({ params }: PageProps) {
  const { code } = await params;
  const fund = await getFundDetail(decodeURIComponent(code));

  if (!fund) {
    notFound();
  }

  const latest = fund.navs.at(-1);
  const chartData = fund.navs.map((nav) => ({
    date: formatDate(nav.tradeDate),
    value: nav.unitNav,
    changeRate: nav.dailyGrowthRate
  }));
  const oneYearReturn = fund.periodReturns.find((item) => item.rangeKey === "year_1");
  const threeMonthReturn = fund.periodReturns.find((item) => item.rangeKey === "month_3");
  const purchaseOpen = isOpenForPurchase(fund.purchaseStatus);
  const profileReady = Boolean(fund.profile);
  const feeReady = fund.fees.length > 0;
  const simulation = fund.investmentSimulation;
  const shareClasses = fund.shareClassComparison.items;
  const shareClassBreakEven = fund.shareClassComparison.breakEven;
  const drawdownValue =
    fund.riskMetrics.maxDrawdown === null || fund.riskMetrics.maxDrawdown === undefined
      ? null
      : 10000 * (1 + fund.riskMetrics.maxDrawdown / 100);
  const drawdownOk =
    fund.riskMetrics.maxDrawdown === null || fund.riskMetrics.maxDrawdown === undefined
      ? null
      : fund.riskMetrics.maxDrawdown >= -10;
  const navSampleCount = fund.navs.length;
  const dataCoverage = fund.dataCoverage;
  const dataScore = dataCoverage.score;
  const dataCoverageLabel = dataCoverage.label;
  const legacyDataScore =
    (navSampleCount >= 240 ? 35 : navSampleCount >= 60 ? 20 : navSampleCount >= 14 ? 10 : 0) +
    (fund.periodReturns.filter((item) => item.rankValue !== null && item.rankValue !== undefined).length >= 5 ? 25 : 0) +
    (profileReady ? 15 : 0) +
    (feeReady ? 15 : 0) +
    (fund.latestRating ? 10 : 0);
  const dataQuality = dataScore >= 80 ? "高" : dataScore >= 55 ? "中" : "低";
  const decisionTone =
    dataScore < 55
      ? "数据不足，先补历史和资料"
      : !purchaseOpen
        ? "申购受限，先确认交易平台状态"
        : fund.riskMetrics.maxDrawdown !== null && fund.riskMetrics.maxDrawdown <= -20
          ? "波动偏高，适合谨慎观察"
          : oneYearReturn?.peerPercentile && oneYearReturn.peerPercentile >= 80
            ? "同类表现靠前，可加入候选池继续比较"
            : "信息可读，继续比较同类和费用";
  const holdingParams = new URLSearchParams({
    targetType: "fund",
    targetKey: fund.code
  });
  if (latest?.unitNav) {
    holdingParams.set("costPrice", String(latest.unitNav));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{fund.code}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{fund.name}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {fund.fundType ?? "基金"} · 申购 {fund.purchaseStatus ?? "--"} · 赎回 {fund.redeemStatus ?? "--"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/funds/${encodeURIComponent(fund.code)}/history`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            完整历史
          </Link>
          <Link href={`/funds/${encodeURIComponent(fund.code)}/profile`} className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-steel">
            基金资料
          </Link>
          <WatchButton targetType="fund" code={fund.code} initialWatched={fund.watched} />
        </div>
      </div>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <div>
            <h2 className="text-lg font-semibold text-ink">一句话风险结论</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{decisionTone}。这不是买卖建议，实际操作前还要结合你的仓位、持有期限和可承受回撤。</p>
          </div>
          <DecisionMetric label="数据可信度" value={dataQuality} helper={`${dataScore}/100 · ${navSampleCount} 个净值样本`} />
          <DecisionMetric
            label="研究优先级"
            value={purchaseOpen && dataScore >= 55 ? "可研究" : "先补充"}
            helper={purchaseOpen ? "申购状态可继续核对" : "申购状态需要确认"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <BackfillButton action="fund_full" code={fund.code} label="一键补本基金" />
          <BackfillButton action="fund_history" code={fund.code} label="补 3 年净值" />
          <BackfillButton action="fund_profile" code={fund.code} label="补资料/费率/持仓" />
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">数据可信度</h2>
            <p className="mt-1 text-sm text-slate-600">{dataCoverage.summary}</p>
          </div>
          <div className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-slate-600">
            类型：{fund.fundType ?? "--"} · 来源：{fund.fundTypeSource ?? "--"} · 样本：{dataCoverage.navCoverageLabel}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {dataCoverage.checks.map((item) => (
            <ChecklistItem key={item.key} label={item.label} status={item.status} detail={item.detail} />
          ))}
        </div>
        {dataCoverage.missingActions.length ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-3 text-sm text-slate-600">
            <div className="font-medium text-ink">建议补数</div>
            <div className="mt-1">{dataCoverage.missingActions.join(" / ")}</div>
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">买入决策面板</h2>
            <p className="mt-1 text-sm text-slate-600">先核对交易状态、收益样本、回撤压力和费用规模，再决定是否记录买入计划。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/portfolio?${holdingParams.toString()}`}
              className="focus-ring rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
            >
              记录买入
            </Link>
            <AddCompareButton targetType="fund" targetKey={fund.code} name={fund.name} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DecisionMetric
            label="申购状态"
            value={fund.purchaseStatus ?? "--"}
            helper={purchaseOpen ? "当前状态允许继续核对买入" : "买入前先确认销售平台是否可申购"}
          />
          <DecisionMetric
            label="近1年收益"
            value={<TrendBadge value={oneYearReturn?.rankValue} />}
            helper={
              oneYearReturn?.peerPercentile
                ? `同类超过 ${formatNumber(oneYearReturn.peerPercentile, 1)}%`
                : `排行日 ${formatDate(oneYearReturn?.rankDate)}`
            }
          />
          <DecisionMetric
            label="样本最大回撤"
            value={fund.riskMetrics.maxDrawdown === null ? "--" : `${formatNumber(fund.riskMetrics.maxDrawdown, 2)}%`}
            helper={drawdownValue === null ? "净值样本不足" : `买入 1 万元样本低点约 ${formatNumber(drawdownValue, 0)} 元`}
          />
          <DecisionMetric
            label="近3月 / 规模"
            value={<TrendBadge value={threeMonthReturn?.rankValue} />}
            helper={`规模 ${fund.profile?.latestScale ?? "--"}`}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ChecklistItem label="可申购" status={purchaseOpen ? "ok" : "warn"} detail={fund.purchaseStatus ?? "未披露"} />
          <ChecklistItem
            label="回撤可承受"
            status={drawdownOk === null ? "missing" : drawdownOk ? "ok" : "warn"}
            detail={drawdownOk === null ? "净值样本不足" : drawdownOk ? "样本回撤未超过 10%" : "样本回撤超过 10%"}
          />
          <ChecklistItem
            label="收益样本可读"
            status={oneYearReturn?.rankValue === null || oneYearReturn?.rankValue === undefined ? "missing" : "ok"}
            detail={
              oneYearReturn?.peerRank && oneYearReturn.peerTotal
                ? `同类第 ${oneYearReturn.peerRank}/${oneYearReturn.peerTotal}`
                : oneYearReturn?.rankValue === null || oneYearReturn?.rankValue === undefined
                  ? "缺少近1年收益"
                  : "已接入近1年排行"
            }
          />
          <ChecklistItem
            label="资料与费率"
            status={profileReady && feeReady ? "ok" : "missing"}
            detail={profileReady && feeReady ? "资料和费率已采集" : "资料或费率仍需补采"}
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="最新净值" value={formatNumber(latest?.unitNav)} />
        <Info label="累计净值" value={formatNumber(latest?.accumulatedNav)} />
        <Info label="日增长率" value={<TrendBadge value={latest?.dailyGrowthRate} />} />
        <Info label="交易日" value={formatDate(latest?.tradeDate)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="样本最大回撤" value={<TrendBadge value={fund.riskMetrics.maxDrawdown} />} />
        <Info label="年化波动率" value={`${formatNumber(fund.riskMetrics.volatility, 2)}%`} />
        <Info label="夏普比率" value={formatNumber(fund.riskMetrics.sharpe, 2)} />
        <Info label="样本年化收益" value={<TrendBadge value={fund.riskMetrics.annualizedReturn} />} />
      </section>

      {fund.fundClassification.assetMode !== "open" ? (
        <section className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">专项数据</h2>
          <p className="mt-1 text-sm text-slate-600">
            {fund.fundClassification.assetMode === "money"
              ? "货币基金优先看万份收益和七日年化，单位净值涨跌不适合作为主要判断。"
              : fund.fundClassification.assetMode === "exchange"
                ? "ETF/LOF 需要同时看场内价格、成交额和折溢价，净值涨跌不能完整反映交易成本。"
                : fund.fundClassification.assetMode === "qdii"
                  ? "QDII 净值通常滞后，买前需要额外留意估值日期和海外市场波动。"
                  : "该类型基金需要结合专属指标查看。"}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fund.fundClassification.assetMode === "money" ? (
              <>
                <Info label="万份收益" value={formatNumber(fund.latestMoneyData?.tenThousandIncome, 4)} />
                <Info label="七日年化" value={<TrendBadge value={fund.latestMoneyData?.sevenDayAnnualized} />} />
                <Info label="货币数据日" value={formatDate(fund.latestMoneyData?.tradeDate)} />
                <Info label="购买状态" value={fund.latestMoneyData?.purchaseStatus ?? fund.purchaseStatus ?? "--"} />
              </>
            ) : null}
            {fund.fundClassification.assetMode === "exchange" ? (
              <>
                <Info label="场内价格" value={formatNumber(fund.latestExchangeQuote?.latestPrice, 4)} />
                <Info label="场内涨跌" value={<TrendBadge value={fund.latestExchangeQuote?.changeRate} />} />
                <Info label="折溢价" value={<TrendBadge value={fund.latestExchangeQuote?.discountRate} />} />
                <Info label="成交额" value={formatNumber(fund.latestExchangeQuote?.amount, 2)} />
              </>
            ) : null}
            {fund.fundClassification.assetMode === "qdii" ? (
              <>
                <Info label="最新净值日" value={formatDate(latest?.tradeDate)} />
                <Info label="近 1 月" value={<TrendBadge value={fund.periodReturns.find((item) => item.rangeKey === "month_1")?.rankValue} />} />
                <Info label="近 1 年" value={<TrendBadge value={oneYearReturn?.rankValue} />} />
                <Info label="数据提醒" value="注意净值滞后" />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">买入前核对</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="基金经理" value={fund.profile?.managerNames} />
            <Field label="基金规模" value={fund.profile?.latestScale} />
            <Field label="基金公司" value={fund.profile?.fundCompany} />
            <Field label="成立时间" value={formatDate(fund.profile?.inceptionDate)} />
            <Field label="申购状态" value={fund.purchaseStatus} />
            <Field label="赎回状态" value={fund.redeemStatus} />
            <Field label="评级家数" value={fund.latestRating?.fiveStarCount?.toString()} />
            <Field label="首条费率" value={fund.fees[0]?.feeValue} />
          </div>
        </div>
        <div className="rounded-md border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-ink">风险提醒</h2>
          <div className="mt-3 space-y-3">
            {fund.warnings.length === 0 ? (
              <p className="text-sm text-slate-500">暂无触发的持有风险提醒。</p>
            ) : (
              fund.warnings.map((item) => (
                <div className="rounded-md border border-line bg-paper p-3 text-sm" key={`${item.metric}-${item.title}`}>
                  <div className="font-medium text-ink">{item.title}</div>
                  <div className="mt-1 text-slate-600">{item.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">阶段收益</h2>
            <p className="mt-1 text-sm text-slate-600">来自开放式基金排行数据，展示各周期最新可用收益率。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {fund.periodReturns.map((item) => (
            <div className="rounded-md border border-line bg-paper px-3 py-3" key={item.rangeKey}>
              <div className="text-sm text-slate-600">{item.label}</div>
              <div className="mt-2 text-lg font-semibold">
                <TrendBadge value={item.rankValue} />
              </div>
              <div className="mt-1 text-xs text-slate-500">排行日 {formatDate(item.rankDate)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {item.peerRank && item.peerTotal
                  ? `同类 ${item.peerRank}/${item.peerTotal} · 超过 ${formatNumber(item.peerPercentile, 1)}%`
                  : "同类百分位不足"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">A/C 份额费用对比</h2>
          <p className="mt-1 text-sm text-slate-600">
            按同名基金识别份额，估算 1 万元持有 30 天和 1 年的申购费与销售服务费成本。
          </p>
          {shareClassBreakEven ? (
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">A/C 临界天数</div>
                <div className="mt-1 font-semibold text-ink">
                  {shareClassBreakEven.breakEvenDays === null ? "暂无明显临界点" : `约 ${formatNumber(shareClassBreakEven.breakEvenDays, 0)} 天`}
                </div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 30 天</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better30d.shareClass} 类成本低</div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 90 天</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better90d.shareClass} 类成本低</div>
              </div>
              <div className="rounded-md border border-line bg-paper px-3 py-2">
                <div className="text-slate-500">持有 1 年</div>
                <div className="mt-1 font-semibold text-ink">{shareClassBreakEven.better365d.shareClass} 类成本低</div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">份额</th>
                <th className="px-4 py-3 font-medium">基金</th>
                <th className="px-4 py-3 text-right font-medium">近1年收益</th>
                <th className="px-4 py-3 text-right font-medium">申购费</th>
                <th className="px-4 py-3 text-right font-medium">销售服务费</th>
                <th className="px-4 py-3 text-right font-medium">30天成本</th>
                <th className="px-4 py-3 text-right font-medium">1年成本</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shareClasses.length <= 1 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    暂未识别到同名 A/C 份额，或费率数据仍需补采。
                  </td>
                </tr>
              ) : (
                shareClasses.map((item) => (
                  <tr key={item.code} className={item.isCurrent ? "bg-paper/70" : undefined}>
                    <td className="px-4 py-3 font-medium">{item.shareClass}</td>
                    <td className="px-4 py-3">
                      <Link href={`/funds/${encodeURIComponent(item.code)}`} className="focus-ring rounded font-medium text-ink">
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge value={item.yearReturn} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.feeSummary.subscriptionRate, 2)}%</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.feeSummary.serviceRate, 2)}%</td>
                    <td className="px-4 py-3 text-right">¥{formatNumber(item.cost30d, 2)}</td>
                    <td className="px-4 py-3 text-right">¥{formatNumber(item.cost365d, 2)}</td>
                    <td className="px-4 py-3 text-slate-600">{item.purchaseStatus ?? "--"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">定投模拟</h2>
            <p className="mt-1 text-sm text-slate-600">按每月 1,000 元、每月首个净值日买入估算，不含申赎费和分红再投。</p>
          </div>
        </div>
        {simulation ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="定投期数" value={`${simulation.months} 期`} />
            <Info label="累计投入" value={`¥${formatNumber(simulation.invested, 2)}`} />
            <Info label="当前市值" value={`¥${formatNumber(simulation.currentValue, 2)}`} />
            <Info label="定投收益率" value={<TrendBadge value={simulation.profitRate} />} />
            <Info label="最大浮亏" value={<TrendBadge value={simulation.maxFloatingLoss} />} />
            <Info label="一次性买入收益" value={<TrendBadge value={simulation.lumpProfitRate} />} />
            <Info label="开始日期" value={formatDate(simulation.startDate)} />
            <Info label="结束日期" value={formatDate(simulation.endDate)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">净值样本不足，暂不能模拟定投。</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">单位净值曲线</h2>
        <NavChart data={chartData} valueLabel="单位净值" />
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">分红配送</h2>
          <p className="mt-1 text-sm text-slate-600">现金分红按每份和每 10 份展示；ETF 数据按累计分红展示。</p>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">权益登记日</th>
                <th className="px-4 py-3 font-medium">除息日</th>
                <th className="px-4 py-3 font-medium">发放日</th>
                <th className="px-4 py-3 text-right font-medium">每10份</th>
                <th className="px-4 py-3 text-right font-medium">累计分红</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fund.dividends.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    暂无结构化分红数据
                  </td>
                </tr>
              ) : (
                fund.dividends.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.dividendType}</td>
                    <td className="px-4 py-3">{formatDate(item.registrationDate)}</td>
                    <td className="px-4 py-3">{formatDate(item.exDividendDate)}</td>
                    <td className="px-4 py-3">{formatDate(item.paymentDate)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.dividendPer10, 4)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(item.cumulativeDividend, 4)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">最近净值</h2>
        </div>
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-paper text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 text-right font-medium">单位净值</th>
                <th className="px-4 py-3 text-right font-medium">累计净值</th>
                <th className="px-4 py-3 text-right font-medium">日增长值</th>
                <th className="px-4 py-3 text-right font-medium">日增长率</th>
                <th className="px-4 py-3 font-medium">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...fund.navs].reverse().slice(0, 30).map((nav) => (
                <tr key={nav.id}>
                  <td className="px-4 py-3">{formatDate(nav.tradeDate)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.unitNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.accumulatedNav)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(nav.dailyGrowthValue)}</td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={nav.dailyGrowthRate} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nav.growthRateSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <span className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span>{item.title}</span>
                  <span className={`rounded-md px-2 py-1 text-xs ${announcementImpactClass(item.impact?.level)}`}>
                    {item.impact?.label ?? "低影响"}
                  </span>
                </span>
                <span className="mt-1 block text-slate-500">
                  {item.source} · {formatDate(item.publishedAt)} · {item.impact?.reason ?? "普通公告"}
                </span>
              </a>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600 shadow-panel">
        <h2 className="font-semibold text-ink">口径说明</h2>
        <p className="mt-2">
          阶段收益优先使用开放式基金排行数据；净值曲线使用单位净值。最大回撤、波动率和夏普比率基于本地已采集净值样本计算，不替代基金公司正式披露口径。
        </p>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-panel">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-ink">{value || "--"}</div>
    </div>
  );
}

function DecisionMetric({ label, value, helper }: { label: string; value: ReactNode; helper: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function ChecklistItem({
  label,
  status,
  detail
}: {
  label: string;
  status: "ok" | "warn" | "missing";
  detail: string;
}) {
  const className =
    status === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${className}`}>
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-xs">{detail}</div>
    </div>
  );
}

function announcementImpactClass(level: string | undefined) {
  if (level === "high") {
    return "bg-coral/10 text-coral";
  }
  if (level === "medium") {
    return "bg-steel/10 text-steel";
  }
  return "bg-mint/10 text-mint";
}
