import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const allowedExtensions = new Set([".csv", ".tsv", ".xlsx", ".xls"]);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  const defaultTargetType = formData.get("defaultTargetType");
  const mode = formData.get("mode");
  const mapping = formData.get("mapping");
  const dryRun = formData.get("dryRun");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择 CSV、TSV 或 Excel 文件" }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    return NextResponse.json({ error: "仅支持 .csv、.tsv、.xlsx、.xls" }, { status: 400 });
  }

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "wealth-import-"));
  const tempPath = path.join(tempDir, `transactions${extension}`);

  try {
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const args = ["scripts/collector/import_transactions.py", tempPath];
    if (defaultTargetType === "fund" || defaultTargetType === "wealth") {
      args.push("--default-target-type", defaultTargetType);
    }
    if (typeof mapping === "string" && mapping.trim()) {
      args.push("--mapping-json", mapping);
    }
    if (mode === "preview") {
      args.push("--preview");
    }
    if (dryRun === "1" || dryRun === "true") {
      args.push("--dry-run");
    }
    const { stdout } = await execFileAsync(process.env.PYTHON ?? "python", args, {
      cwd: process.cwd(),
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const payload = JSON.parse(lines.at(-1) ?? "{}") as { inserted?: number; skipped?: number; errors?: string[] };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
