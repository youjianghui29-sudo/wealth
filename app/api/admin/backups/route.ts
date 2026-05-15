import { NextRequest, NextResponse } from "next/server";
import { createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup } from "@/lib/admin-ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ backups: listDatabaseBackups() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "restore") {
      return NextResponse.json(restoreDatabaseBackup({ fileName: String(body.fileName ?? "") }));
    }
    return NextResponse.json({ backup: createDatabaseBackup() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "backup operation failed" }, { status: 400 });
  }
}
