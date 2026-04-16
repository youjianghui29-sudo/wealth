import { NextResponse } from "next/server";
import { formatDate } from "@/lib/format";
import { getFundAllNavs } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(_: Request, { params }: RouteContext) {
  const { code } = await params;
  const result = await getFundAllNavs(decodeURIComponent(code));

  if (!result) {
    return NextResponse.json({ error: "Fund not found" }, { status: 404 });
  }

  const lines = [
    ["fundCode", "fundName", "tradeDate", "unitNav", "accumulatedNav", "dailyGrowthValue", "dailyGrowthRate", "source"].map(csvCell).join(",")
  ];
  for (const nav of result.navs) {
    lines.push(
      [
        result.fund.code,
        result.fund.name,
        formatDate(nav.tradeDate),
        nav.unitNav,
        nav.accumulatedNav,
        nav.dailyGrowthValue,
        nav.dailyGrowthRate,
        nav.source
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fund.code}-navs.csv"`
    }
  });
}
