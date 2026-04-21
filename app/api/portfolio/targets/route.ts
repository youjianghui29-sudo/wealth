import { NextRequest, NextResponse } from "next/server";
import { savePortfolioTargets } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { targets?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.targets)) {
    return NextResponse.json({ error: "targets is required" }, { status: 400 });
  }
  const result = await savePortfolioTargets(
    body.targets.map((item) => ({
      targetKey: String(item.targetKey ?? ""),
      label: String(item.label ?? ""),
      targetWeight: toNumber(item.targetWeight),
      maxWeight: toNumber(item.maxWeight),
      note: item.note ? String(item.note) : null
    }))
  );
  return NextResponse.json(result);
}
