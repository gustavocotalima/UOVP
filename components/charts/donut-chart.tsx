"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/money";

export type DonutDatum = { name: string; value: number; color: string };

export function DonutChart({ data, centerLabel }: { data: DonutDatum[]; centerLabel?: string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="relative h-56 w-full sm:h-64" aria-label={`Gráfico de distribuição. Total ${formatMoney(total)}`} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="63%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>
            {data.map((item) => <Cell key={item.name} fill={item.color} />)}
          </Pie>
          <Tooltip
            formatter={(value) => formatMoney(Number(value))}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
            wrapperStyle={{ zIndex: 20 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 z-0 grid place-items-center text-center">
        <div>
          <p className="text-xs text-[var(--muted-foreground)]">{centerLabel || "Total"}</p>
          <p className="mt-1 text-lg font-semibold">{formatMoney(total)}</p>
        </div>
      </div>
    </div>
  );
}
