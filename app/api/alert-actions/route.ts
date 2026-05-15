import { NextRequest, NextResponse } from "next/server";
import { clearAlertActions, getAlertActionStates, saveAlertAction } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ states: await getAlertActionStates() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await saveAlertAction({
      alertId: String(body.alertId ?? ""),
      action: body.action,
      until: body.until,
      note: typeof body.note === "string" ? body.note : null
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存提醒状态失败" }, { status: 400 });
  }
}

export async function DELETE() {
  return NextResponse.json(await clearAlertActions());
}
