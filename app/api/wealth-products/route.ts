import { NextRequest, NextResponse } from "next/server";
import { getWealthProductList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const result = await getWealthProductList({
    q: searchParams.get("q"),
    issuer: searchParams.get("issuer"),
    riskLevel: searchParams.get("riskLevel"),
    operationMode: searchParams.get("operationMode"),
    direction: searchParams.get("direction"),
    sort: searchParams.get("sort"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize")
  });

  return NextResponse.json(result);
}
