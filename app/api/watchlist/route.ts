import { NextRequest, NextResponse } from "next/server";
import { toggleWatchlist } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    targetType?: string;
    code?: string;
    watched?: boolean;
  };

  if ((body.targetType !== "fund" && body.targetType !== "wealth") || !body.code) {
    return NextResponse.json({ error: "Invalid watchlist payload" }, { status: 400 });
  }

  const result = await toggleWatchlist({
    targetType: body.targetType,
    code: body.code,
    watched: Boolean(body.watched)
  });

  return NextResponse.json(result);
}
