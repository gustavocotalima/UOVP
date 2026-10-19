"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PrivateValue } from "@/components/ui/private-value";

export type DonutDatum = { name: string; value: number; color: string };

export function DonutChart({ data, centerLabel, className, formatTooltip, privateValues = true }: { data: DonutDatum[]; centerLabel?: string; className?: string; formatTooltip?: (name: string, value: number) => string; privateValues?: boolean }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className={cn("relative h-56 w-full sm:h-64", className)} aria-label={`Gráfico de distribuição. Total ${formatMoney(total)}`} role="img">
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="63%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>
              {data.map((item) => <Cell key={item.name} fill={item.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
              formatter={(value, name) => formatTooltip?.(String(name), Number(value)) ?? formatMoney(Number(value))}
              wrapperClassName={privateValues ? "private-chart-tooltip" : undefined}
              wrapperStyle={{ zIndex: 20 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 grid place-items-center text-center">
        <div>
          <p className="text-xs text-[var(--muted-foreground)]">{centerLabel || "Total"}</p>
          <p className="mt-1 text-lg font-semibold"><PrivateValue sensitive={privateValues}>{formatMoney(total)}</PrivateValue></p>
        </div>
      </div>
    </div>
  );
}
