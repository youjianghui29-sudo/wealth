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
const sourcePath = join(root, "lib", "admin-ops.ts");
const compiledPath = join(root, ".tmp-tests", "admin-ops.cjs");
const tempRoot = join(tmpdir(), `wealth-admin-ops-${Date.now()}`);

after(() => {
  rmSync(join(root, ".tmp-tests"), { recursive: true, force: true });
  rmSync(tempRoot, { recursive: true, force: true });
});

function loadAdminOps() {
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

test("backup filename is stable and filesystem safe", () => {
  const { buildBackupFileName } = loadAdminOps();

  assert.equal(buildBackupFileName("2026-04-30T12:34:56.000Z"), "wealth-2026-04-30-123456.sqlite");
});

test("backup listing returns newest sqlite backups first", () => {
  const { listDatabaseBackups } = loadAdminOps();
  const backupDir = join(tempRoot, "backups");
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, "wealth-2026-04-29-100000.sqlite"), "old");
  writeFileSync(join(backupDir, "wealth-2026-04-30-100000.sqlite"), "new");
  writeFileSync(join(backupDir, "ignore.txt"), "x");

  const backups = listDatabaseBackups(backupDir);

  assert.deepEqual(backups.map((item) => item.fileName), [
    "wealth-2026-04-30-100000.sqlite",
    "wealth-2026-04-29-100000.sqlite"
  ]);
});
