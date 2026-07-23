"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

const colors = ["#76b7b2", "#4f86f7", "#d2ad50", "#9b72cf", "#ec6f66", "#59a14f"];

export function ProjectionChart({ rows }: { rows: { contribution: number; values: { years: number; value: number }[] }[] }) {
  const selected = rows.filter((_, index) => [0, 3, 6, 9, 11, 14].includes(index));
  const data = selected[0]?.values.map(({ years }, index) => ({
    years: `${years} anos`,
    ...Object.fromEntries(selected.map((row) => [String(row.contribution), row.values[index].value])),
  })) ?? [];
  return (
    <div className="h-80 w-full" role="img" aria-label="Projeção patrimonial por aporte mensal">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 12, top: 8 }}>
          <XAxis dataKey="years" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={11} width={48} tickFormatter={(value) => `${Math.round(value / 1_000_000)}M`} />
          <Tooltip formatter={(value) => formatMoney(Number(value))} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
          {selected.map((row, index) => (
            <Line key={row.contribution} type="monotone" dataKey={String(row.contribution)} name={formatMoney(row.contribution)} stroke={colors[index]} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
