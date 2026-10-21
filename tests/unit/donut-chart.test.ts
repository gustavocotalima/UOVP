import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chart = vi.hoisted(() => ({ tooltip: vi.fn() }));
vi.mock("recharts", async () => {
  const { createElement } = await import("react");
  const container = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { ResponsiveContainer: container, PieChart: container, Pie: container, Cell: () => null, Tooltip: chart.tooltip };
});
vi.mock("@/features/portfolio/actions", () => ({ saveInvestmentTargetsAction: vi.fn() }));

import { DonutChart, formatDonutValue } from "@/components/charts/donut-chart";
import { TargetsPanel } from "@/features/portfolio/targets-panel";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";
import { formatMoney } from "@/lib/money";

const data = [{ name: "Primeira", value: 25, color: "#2563eb" }, { name: "Segunda", value: 75, color: "#059669" }];

describe("unidade e privacidade do donut", () => {
  beforeEach(() => { chart.tooltip.mockReset(); chart.tooltip.mockReturnValue(null); });

  it("usa porcentagem no centro, no tooltip e na descrição acessível das metas", () => {
    const html = renderToStaticMarkup(createElement(DonutChart, { data, unit: "percent", centerLabel: "Meta total", privateValues: false }));
    expect(html).toContain('aria-label="Gráfico de distribuição. Total 100%"');
    expect(html).toContain(">100%</p>");
    expect(html).not.toContain("R$");
    expect(html).not.toContain("private-value");
    const props = chart.tooltip.mock.calls[0][0];
    expect(props.formatter(25, "Primeira")).toBe("25%");
    expect(props.wrapperClassName).toBeUndefined();
  });

  it("preserva moeda BRL e blur como padrão dos donuts financeiros", () => {
    const html = renderToStaticMarkup(createElement(DonutChart, { data }));
    expect(html).toContain(formatMoney(100));
    expect(html).toContain("private-value");
    const props = chart.tooltip.mock.calls[0][0];
    expect(props.formatter(25, "Primeira")).toBe(formatMoney(25));
    expect(props.wrapperClassName).toBe("private-chart-tooltip");
    expect(formatDonutValue(12.34, "percent")).toBe("12,34%");
  });

  it("integra o painel de metas ao contrato percentual e mantém zero como draft explícito", () => {
    const html = renderToStaticMarkup(createElement(TargetsPanel, { initialTargets: DEFAULT_TARGETS }));
    expect(html).toContain('aria-label="Gráfico de distribuição. Total 100%"');
    expect(html).toContain('aria-label="Meta de Reserva de valor"');
    expect(html).not.toContain("R$");
    expect(html).not.toContain("private-value");
    expect(html).not.toContain('aria-invalid="true"');
  });
});
