import { NextRequest, NextResponse } from "next/server";
import { getFundRankings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const result = await getFundRankings({
    rangeKey: searchParams.get("rangeKey"),
    direction: searchParams.get("direction"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize")
  });

  return NextResponse.json(result);
}
