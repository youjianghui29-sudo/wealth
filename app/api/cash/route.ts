import { NextRequest, NextResponse } from "next/server";
import { getCashDashboard, saveCashAccount, saveCashTransaction } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  return NextResponse.json(await getCashDashboard());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.kind === "account") {
      return NextResponse.json({
        account: await saveCashAccount({
          name: String(body.name ?? ""),
          openingValue: toNumber(body.openingValue),
          note: typeof body.note === "string" ? body.note : null
        })
      });
    }
    return NextResponse.json({
      transaction: await saveCashTransaction({
        accountId: Number(body.accountId),
        transactionType: String(body.transactionType ?? ""),
        transactionDate: body.transactionDate ? String(body.transactionDate) : null,
        amount: toNumber(body.amount),
        relatedTarget: typeof body.relatedTarget === "string" ? body.relatedTarget : null,
        note: typeof body.note === "string" ? body.note : null
      })
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "cash save failed" }, { status: 400 });
  }
}
