import { NextRequest, NextResponse } from "next/server";
import { getFundList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const result = await getFundList({
    q: searchParams.get("q"),
    type: searchParams.get("type"),
    direction: searchParams.get("direction"),
    purchaseStatus: searchParams.get("purchaseStatus"),
    returnRange: searchParams.get("returnRange"),
    minReturn: searchParams.get("minReturn"),
    maxDrawdown: searchParams.get("maxDrawdown"),
    minRate: searchParams.get("minRate"),
    maxRate: searchParams.get("maxRate"),
    sort: searchParams.get("sort"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize")
  });

  return NextResponse.json(result);
}
