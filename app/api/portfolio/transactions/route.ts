import { NextRequest, NextResponse } from "next/server";
import { deletePortfolioTransaction, savePortfolioTransaction } from "@/lib/queries";

export const dynamic = "force-dynamic";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  if (body.targetType !== "fund" && body.targetType !== "wealth") {
    return NextResponse.json({ error: "targetType must be fund or wealth" }, { status: 400 });
  }
  try {
    const noteParts = [
      toOptionalText(body.applicationDate) ? `申请日期：${toOptionalText(body.applicationDate)}` : null,
      toOptionalText(body.platform) ? `交易平台：${toOptionalText(body.platform)}` : null,
      toOptionalText(body.note)
    ].filter((item): item is string => Boolean(item));
    const transaction = await savePortfolioTransaction({
      targetType: body.targetType,
      targetKey: String(body.targetKey ?? ""),
      transactionType: String(body.transactionType ?? ""),
      tradeDate: body.tradeDate ? String(body.tradeDate) : null,
      shares: toNumber(body.shares),
      price: toNumber(body.price),
      amount: toNumber(body.amount),
      fee: toNumber(body.fee),
      note: noteParts.length ? noteParts.join("\n") : null
    });
    return NextResponse.json({ transaction });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { id?: number };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  return NextResponse.json(await deletePortfolioTransaction(Number(body.id)));
}
