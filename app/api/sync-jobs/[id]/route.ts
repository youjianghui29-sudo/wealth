import { NextRequest, NextResponse } from "next/server";
import { markSyncJobFailed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action !== "mark_failed") {
      return NextResponse.json({ error: "unsupported sync job action" }, { status: 400 });
    }
    const job = await markSyncJobFailed(Number(id), typeof body.reason === "string" ? body.reason : "manual mark failed");
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "sync job action failed" }, { status: 400 });
  }
}
