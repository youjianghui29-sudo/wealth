import { NextResponse } from "next/server";
import { getLatestSyncJob } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const job = await getLatestSyncJob();
  return NextResponse.json(job ?? null);
}
