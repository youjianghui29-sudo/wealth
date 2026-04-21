import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BackfillAction = "fund_full" | "fund_history" | "fund_profile" | "portfolio" | "watchlist" | "priority" | "profile_batches";

function normalizeHistoryDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 756;
  }
  return Math.max(60, Math.min(1200, Math.floor(parsed)));
}

function buildArgs(input: { action?: unknown; code?: unknown; historyDays?: unknown }) {
  const action = String(input.action ?? "") as BackfillAction;
  const code = String(input.code ?? "").trim();
  const historyDays = String(normalizeHistoryDays(input.historyDays));
  const args = ["scripts/collector/run_backfill.py", "--skip-broad", "--history-days", historyDays];

  if (action === "fund_full" || action === "fund_history" || action === "fund_profile") {
    if (!/^\d{6}$/.test(code)) {
      throw new Error("基金补数需要 6 位基金代码");
    }
    args.push("--fund-code", code);
    if (action === "fund_history") {
      args.push("--history-limit", "1", "--profile-limit", "0");
    } else if (action === "fund_profile") {
      args.push("--history-limit", "0", "--profile-limit", "1");
    } else {
      args.push("--history-limit", "1", "--profile-limit", "1");
    }
    return args;
  }

  if (action === "portfolio") {
    args.push("--scope", "portfolio", "--history-limit", "200", "--profile-limit", "200");
    return args;
  }

  if (action === "watchlist") {
    args.push("--scope", "watchlist", "--history-limit", "200", "--profile-limit", "200");
    return args;
  }

  if (action === "priority") {
    args.push("--scope", "priority", "--history-limit", "200", "--profile-limit", "200");
    return args;
  }

  if (action === "profile_batches") {
    return [
      "scripts/collector/run_fund_profile_batches.py",
      "--batch-size",
      "20",
      "--batch-timeout-seconds",
      "900",
      "--pause-seconds",
      "1"
    ];
  }

  throw new Error("未知补数任务");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const args = buildArgs(body);
    const running = await prisma.syncJob.findFirst({
      where: {
        status: "running",
        OR: [
          { jobType: { contains: "collect" } },
          { jobType: { contains: "backfill" } },
          { jobType: { contains: "profile" } }
        ]
      },
      orderBy: { startedAt: "desc" }
    });
    if (running) {
      return NextResponse.json(
        { error: `已有补数任务运行中：${running.jobType}，开始于 ${running.startedAt.toISOString()}` },
        { status: 409 }
      );
    }
    const python = process.env.PYTHON ?? "python";
    const child = spawn(python, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return NextResponse.json({ started: true, pid: child.pid, args });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "启动补数任务失败" }, { status: 400 });
  }
}
