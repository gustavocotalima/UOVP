import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostValue } from "@/features/portfolio/assets-panel/presentation";

describe("apresentação da moeda do custo", () => {
  it("mostra custo USD sem rotular ou converter para reais", () => {
    const html = renderToStaticMarkup(createElement(CostValue, { value: "50", currency: "USD" }));
    expect(html).toContain("US$");
    expect(html).toContain("50,00");
    expect(html).not.toContain("R$");
    expect(html).toContain("private-value");
  });

  it("mostra custo BRL explicitamente e identifica a moeda legada desconhecida", () => {
    expect(renderToStaticMarkup(createElement(CostValue, { value: "250", currency: "BRL" }))).toContain("R$");
    const unknown = renderToStaticMarkup(createElement(CostValue, { value: "500", currency: null }));
    expect(unknown).toContain("Moeda do custo não informada");
    expect(unknown).not.toContain("R$");
    expect(unknown).not.toContain("US$");
  });
});
