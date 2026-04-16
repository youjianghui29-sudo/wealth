import { NextRequest, NextResponse } from "next/server";
import { deletePortfolioHolding, getPortfolioDashboard, savePortfolioHolding } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  return NextResponse.json(await getPortfolioDashboard());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  if (body.targetType !== "fund" && body.targetType !== "wealth") {
    return NextResponse.json({ error: "targetType must be fund or wealth" }, { status: 400 });
  }
  try {
    const holding = await savePortfolioHolding({
      targetType: body.targetType,
      targetKey: String(body.targetKey ?? ""),
      shares: toNumber(body.shares),
      costAmount: toNumber(body.costAmount),
      costPrice: toNumber(body.costPrice),
      purchaseDate: body.purchaseDate ? String(body.purchaseDate) : null,
      note: body.note ? String(body.note) : null
    });
    return NextResponse.json({ holding });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { id?: number };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  return NextResponse.json(await deletePortfolioHolding(Number(body.id)));
}
