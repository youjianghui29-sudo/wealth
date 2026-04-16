import { NextResponse } from "next/server";
import { getFundDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { code } = await params;
  const fund = await getFundDetail(decodeURIComponent(code));

  if (!fund) {
    return NextResponse.json({ error: "Fund not found" }, { status: 404 });
  }

  return NextResponse.json(fund);
}
