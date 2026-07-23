"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

export function BudgetHistoryChart({ data, mode }: { data: { month: string; income: number; spent: number }[]; mode: "income" | "spent" }) {
  const key = mode === "income" ? "income" : "spent";
  const color = mode === "income" ? "#76bc8e" : "#d2ad50";
  return (
    <div className="h-72 w-full" role="img" aria-label={`Histórico de ${mode === "income" ? "renda" : "gastos"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 8, right: 8 }}>
          <defs>
            <linearGradient id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.38} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
          <Tooltip formatter={(value) => formatMoney(Number(value))} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
          <Area type="monotone" dataKey={key} stroke={color} fill={`url(#fill-${key})`} strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
