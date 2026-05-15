import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type DailyBrief = {
  fileName: string;
  path: string;
  content: string;
  updatedAt: Date;
};

export function findLatestDailyBrief(directory = path.join(process.cwd(), "data", "reports")): DailyBrief | null {
  if (!existsSync(directory)) {
    return null;
  }
  const files = readdirSync(directory)
    .filter((fileName) => fileName.toLowerCase().endsWith(".md") && fileName.toLowerCase().includes("brief"))
    .map((fileName) => {
      const filePath = path.join(directory, fileName);
      const stats = statSync(filePath);
      const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      const sortKey = dateMatch?.[1] ?? stats.mtime.toISOString();
      return { fileName, filePath, stats, sortKey };
    })
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || b.stats.mtime.getTime() - a.stats.mtime.getTime());
  const latest = files[0];
  if (!latest) {
    return null;
  }
  return {
    fileName: latest.fileName,
    path: latest.filePath,
    content: readFileSync(latest.filePath, "utf8"),
    updatedAt: latest.stats.mtime
  };
}

export function buildDailyBriefPreview(markdown: string, maxLines = 8) {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const nonEmptyCount = markdown.split(/\r?\n/).filter((line) => line.trim()).length;
  return {
    lines,
    truncated: nonEmptyCount > lines.length
  };
}
