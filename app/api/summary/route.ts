import { NextResponse } from "next/server";
import { getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getSummary();
  return NextResponse.json(summary);
}
