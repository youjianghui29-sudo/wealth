import { NextRequest, NextResponse } from "next/server";
import { closeDecisionRecord, getDecisionRecords, saveDecisionRecord } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  return NextResponse.json({ items: await getDecisionRecords() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "close") {
      return NextResponse.json({ record: await closeDecisionRecord(Number(body.id), typeof body.outcomeNote === "string" ? body.outcomeNote : null) });
    }
    return NextResponse.json({
      record: await saveDecisionRecord({
        targetType: body.targetType === "wealth" ? "wealth" : "fund",
        targetKey: String(body.targetKey ?? ""),
        decisionType: String(body.decisionType ?? ""),
        reason: typeof body.reason === "string" ? body.reason : null,
        plannedAmount: toNumber(body.plannedAmount),
        reviewDate: body.reviewDate ? String(body.reviewDate) : null
      })
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "decision save failed" }, { status: 400 });
  }
}
