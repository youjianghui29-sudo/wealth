export function formatNumber(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "--";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "--";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function trendClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "text-slate-500";
  }

  if (value > 0) {
    return "text-coral";
  }

  if (value < 0) {
    return "text-mint";
  }

  return "text-slate-600";
}
