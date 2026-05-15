import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export type DatabaseBackup = {
  fileName: string;
  path: string;
  size: number;
  createdAt: Date;
};

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "wealth.sqlite");
export const DEFAULT_BACKUP_DIR = path.join(process.cwd(), "data", "backups");

export function buildBackupFileName(now: string | Date = new Date()) {
  const date = typeof now === "string" ? new Date(now) : now;
  const iso = date.toISOString();
  return `wealth-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}.sqlite`;
}

export function listDatabaseBackups(backupDir = DEFAULT_BACKUP_DIR): DatabaseBackup[] {
  if (!existsSync(backupDir)) {
    return [];
  }
  return readdirSync(backupDir)
    .filter((fileName) => fileName.endsWith(".sqlite"))
    .map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      const stats = statSync(filePath);
      return { fileName, path: filePath, size: stats.size, createdAt: stats.mtime };
    })
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
}

export function createDatabaseBackup(input: { dbPath?: string; backupDir?: string; now?: string | Date } = {}) {
  const dbPath = input.dbPath ?? DEFAULT_DB_PATH;
  const backupDir = input.backupDir ?? DEFAULT_BACKUP_DIR;
  if (!existsSync(dbPath)) {
    throw new Error("database file does not exist");
  }
  mkdirSync(backupDir, { recursive: true });
  const fileName = buildBackupFileName(input.now ?? new Date());
  const targetPath = path.join(backupDir, fileName);
  copyFileSync(dbPath, targetPath);
  const stats = statSync(targetPath);
  return { fileName, path: targetPath, size: stats.size, createdAt: stats.mtime };
}

export function restoreDatabaseBackup(input: { fileName: string; dbPath?: string; backupDir?: string }) {
  const dbPath = input.dbPath ?? DEFAULT_DB_PATH;
  const backupDir = input.backupDir ?? DEFAULT_BACKUP_DIR;
  const sourcePath = path.join(backupDir, path.basename(input.fileName));
  if (!sourcePath.startsWith(backupDir) || !existsSync(sourcePath)) {
    throw new Error("backup file does not exist");
  }
  if (existsSync(dbPath)) {
    createDatabaseBackup({ dbPath, backupDir, now: new Date() });
  }
  const tempPath = `${dbPath}.restore-tmp`;
  copyFileSync(sourcePath, tempPath);
  renameSync(tempPath, dbPath);
  return { restored: true, fileName: path.basename(sourcePath) };
}
