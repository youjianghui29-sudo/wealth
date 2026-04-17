"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TargetType = "fund" | "wealth";

type CompareTarget = {
  targetType: TargetType;
  targetKey: string;
  name: string;
};

const STORAGE_KEY = "wealth.compare.targets";
const COMPARE_EVENT = "wealth-compare-change";
const MAX_TARGETS = 8;

function isTarget(value: unknown): value is CompareTarget {
  const item = value as Partial<CompareTarget>;
  return (
    (item.targetType === "fund" || item.targetType === "wealth") &&
    typeof item.targetKey === "string" &&
    item.targetKey.length > 0 &&
    typeof item.name === "string"
  );
}

function readTargets() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(isTarget).slice(0, MAX_TARGETS) : [];
  } catch {
    return [];
  }
}

function writeTargets(targets: CompareTarget[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(targets.slice(0, MAX_TARGETS)));
  window.dispatchEvent(new Event(COMPARE_EVENT));
}

function targetId(target: Pick<CompareTarget, "targetType" | "targetKey">) {
  return `${target.targetType}:${target.targetKey}`;
}

function useCompareTargets() {
  const [targets, setTargets] = useState<CompareTarget[]>([]);

  useEffect(() => {
    const refresh = () => setTargets(readTargets());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(COMPARE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(COMPARE_EVENT, refresh);
    };
  }, []);

  return targets;
}

export function AddCompareButton({
  targetType,
  targetKey,
  name,
  className
}: {
  targetType: TargetType;
  targetKey: string;
  name: string;
  className?: string;
}) {
  const targets = useCompareTargets();
  const currentId = targetId({ targetType, targetKey });
  const inCompare = targets.some((item) => targetId(item) === currentId);

  function toggle() {
    const currentTargets = readTargets();
    const exists = currentTargets.some((item) => targetId(item) === currentId);
    const next = exists
      ? currentTargets.filter((item) => targetId(item) !== currentId)
      : [...currentTargets.filter((item) => targetId(item) !== currentId), { targetType, targetKey, name }].slice(-MAX_TARGETS);
    writeTargets(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={
        className ??
        "focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-steel transition hover:border-steel hover:text-ink"
      }
    >
      {inCompare ? "移出对比" : "加入对比"}
    </button>
  );
}

export function CompareTray() {
  const targets = useCompareTargets();
  const href = useMemo(() => {
    const query = targets.map((item) => targetId(item)).join(",");
    return `/compare?targets=${encodeURIComponent(query)}`;
  }, [targets]);

  if (targets.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-panel">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">已选 {targets.length} 个对比标的</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
            {targets.map((item) => (
              <span className="max-w-48 truncate rounded-md border border-line bg-paper px-2 py-1" key={targetId(item)}>
                {item.name} / {item.targetKey}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => writeTargets([])}
            className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700"
          >
            清空
          </button>
          <Link href={href} className="focus-ring rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">
            开始对比
          </Link>
        </div>
      </div>
    </div>
  );
}
