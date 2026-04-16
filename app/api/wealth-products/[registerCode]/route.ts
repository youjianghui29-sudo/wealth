import { NextResponse } from "next/server";
import { getWealthProductDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ registerCode: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { registerCode } = await params;
  const product = await getWealthProductDetail(decodeURIComponent(registerCode));

  if (!product) {
    return NextResponse.json({ error: "Wealth product not found" }, { status: 404 });
  }

  return NextResponse.json(product);
}
