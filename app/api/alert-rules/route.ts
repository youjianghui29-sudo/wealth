import { NextRequest, NextResponse } from "next/server";
import { saveAlertRule } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  if (body.targetType !== "fund" && body.targetType !== "wealth") {
    return NextResponse.json({ error: "targetType must be fund or wealth" }, { status: 400 });
  }
  try {
    const result = await saveAlertRule({
      targetType: body.targetType,
      targetKey: String(body.targetKey ?? ""),
      metric: String(body.metric ?? ""),
      threshold: toNumber(body.threshold),
      note: body.note ? String(body.note) : null
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
