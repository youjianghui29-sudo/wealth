"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { NavPoint } from "@/lib/types";

export function NavChart({ data, valueLabel }: { data: NavPoint[]; valueLabel: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-line bg-white text-sm text-slate-500">
        暂无历史曲线
      </div>
    );
  }

  return (
    <div className="h-72 rounded-md border border-line bg-white p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#d9e2e8" strokeDasharray="4 4" />
          <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={56} domain={["auto", "auto"]} />
          <Tooltip
            formatter={(value) => [value, valueLabel]}
            labelFormatter={(value) => `日期：${value}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#0f8f72"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
