import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourcePath = join(root, "lib", "daily-brief.ts");
const compiledPath = join(root, ".tmp-tests", "daily-brief.cjs");
const tempRoot = join(tmpdir(), `wealth-brief-test-${Date.now()}`);

after(() => {
  rmSync(join(root, ".tmp-tests"), { recursive: true, force: true });
  rmSync(tempRoot, { recursive: true, force: true });
});

function loadDailyBrief() {
  const source = createRequire(import.meta.url)("node:fs").readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  mkdirSync(dirname(compiledPath), { recursive: true });
  writeFileSync(compiledPath, output);
  const require = createRequire(import.meta.url);
  delete require.cache[compiledPath];
  return require(compiledPath);
}

test("daily brief helper selects the latest markdown brief", () => {
  const { findLatestDailyBrief } = loadDailyBrief();
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(join(tempRoot, "fund-daily-brief-2026-04-28.md"), "# Old\n\nold");
  writeFileSync(join(tempRoot, "fund-daily-brief-2026-04-30.md"), "# New\n\nnew");
  writeFileSync(join(tempRoot, "notes.txt"), "ignore");

  const brief = findLatestDailyBrief(tempRoot);

  assert.equal(brief?.fileName, "fund-daily-brief-2026-04-30.md");
  assert.match(brief?.content ?? "", /# New/);
});

test("daily brief helper extracts a compact preview", () => {
  const { buildDailyBriefPreview } = loadDailyBrief();

  const preview = buildDailyBriefPreview("# 今日简报\n\n- 处理 A\n- 处理 B\n\n## 数据\n\n内容", 3);

  assert.deepEqual(preview.lines, ["# 今日简报", "- 处理 A", "- 处理 B"]);
  assert.equal(preview.truncated, true);
});
