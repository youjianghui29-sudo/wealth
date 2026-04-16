import { NextRequest, NextResponse } from "next/server";
import { getFundNavHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { code } = await params;
  const searchParams = request.nextUrl.searchParams;
  const result = await getFundNavHistory(decodeURIComponent(code), {
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize")
  });

  if (!result) {
    return NextResponse.json({ error: "Fund not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
