import { NextRequest, NextResponse } from "next/server";
import { getDecisionQueueMissingFields } from "@/lib/fund-ux";
import { saveWatchlistDecision } from "@/lib/queries";

export const dynamic = "force-dynamic";

function numberOrFallback(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    targetType?: string;
    code?: string;
    settings?: Record<string, unknown>;
  };
  if ((body.targetType !== "fund" && body.targetType !== "wealth") || !body.code || !body.settings) {
    return NextResponse.json({ error: "Invalid decision payload" }, { status: 400 });
  }

  const riskProfile = String(body.settings.riskProfile ?? "balanced");
  const observationStatus = String(body.settings.observationStatus ?? "researching");
  const missing = getDecisionQueueMissingFields({
    buyCondition: String(body.settings.buyCondition ?? ""),
    rejectCondition: String(body.settings.rejectCondition ?? ""),
    reviewDate: String(body.settings.reviewDate ?? "")
  });
  if (missing.length) {
    return NextResponse.json({ error: `Missing decision fields: ${missing.join(", ")}` }, { status: 400 });
  }
  const result = await saveWatchlistDecision({
    targetType: body.targetType,
    code: body.code,
    settings: {
      riskProfile: ["conservative", "balanced", "aggressive"].includes(riskProfile) ? riskProfile : "balanced",
      plannedAmount: Math.max(1, numberOrFallback(body.settings.plannedAmount, 10000)),
      maxDrawdownTolerance: Math.max(1, numberOrFallback(body.settings.maxDrawdownTolerance, 15)),
      targetReturn: numberOrFallback(body.settings.targetReturn, 8),
      observationStatus: ["researching", "waiting_pullback", "ready_to_buy", "bought", "rejected"].includes(observationStatus)
        ? observationStatus
        : "researching",
      buyCondition: String(body.settings.buyCondition ?? ""),
      rejectCondition: String(body.settings.rejectCondition ?? ""),
      reviewDate: String(body.settings.reviewDate ?? ""),
      reviewNote: String(body.settings.reviewNote ?? "")
    }
  });

  return NextResponse.json(result);
}
