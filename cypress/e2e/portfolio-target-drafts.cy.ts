describe("edição numérica das metas e unidade do gráfico", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("#portfolio-tab-targets").click();
  });

  it("não converte campo vazio em zero e mantém o preview percentual legível com privacidade", () => {
    cy.get('button[aria-label="Ocultar valores"]:visible').click();
    cy.get('#portfolio-panel-targets [role="img"]').should("have.attr", "aria-label", "Gráfico de distribuição. Total 100%")
      .and("have.css", "filter", "none").and("not.have.descendants", ".private-value");
    cy.get('input[aria-label="Meta de Reserva de valor"]').clear().should("have.value", "")
      .and("have.attr", "aria-invalid", "true");
    cy.contains("button", "Salvar metas").should("be.disabled");
    cy.get('input[aria-label="Meta de Reserva de valor"]').type("0").should("have.value", "0")
      .and("have.attr", "aria-invalid", "false");
    cy.contains("button", "Salvar metas").should("be.enabled");
    cy.get('input[aria-label="Meta de Ações nacionais"]').clear().type("17").should("have.value", "17");
    cy.get('input[aria-label="Ajustar meta de Ações nacionais"]').should("have.value", "17");
    cy.contains("button", "Salvar metas").should("be.disabled");
    cy.get('input[aria-label="Meta de Ações internacionais"]').clear().type("13");
    cy.contains("button", "Salvar metas").should("be.enabled");
    cy.get('#portfolio-panel-targets [role="img"]').should("have.attr", "aria-label", "Gráfico de distribuição. Total 100%");
    cy.get('input[aria-label="Meta de Ações internacionais"]').clear().type("13.004")
      .should("have.value", "13.004").and("have.attr", "aria-invalid", "true");
    cy.contains("button", "Salvar metas").should("be.disabled");
    cy.contains("até duas casas decimais").should("be.visible");
    cy.get('input[aria-label="Meta de Ações internacionais"]').clear().type("13");
    cy.contains("button", "Salvar metas").should("be.enabled");
  });

  it("sincroniza presets, desfazer, slider e persistência sem perder os drafts", () => {
    cy.contains("button", "Conservador").click();
    cy.get('input[aria-label="Meta de Ações nacionais"]').should("have.value", "3");
    cy.get('input[aria-label="Meta de Ações internacionais"]').should("have.value", "2");
    cy.contains("button", "Desfazer").click();
    cy.get('input[aria-label="Meta de Ações nacionais"]').should("have.value", "20");
    cy.get('input[aria-label="Meta de Ações internacionais"]').should("have.value", "10");
    cy.contains("button", "Conservador").click();
    cy.get('input[aria-label="Ajustar meta de Ações nacionais"]').then(($range) => {
      const input = $range[0] as HTMLInputElement;
      const appWindow = input.ownerDocument.defaultView!;
      const setter = Object.getOwnPropertyDescriptor(appWindow.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "4");
      input.dispatchEvent(new appWindow.Event("input", { bubbles: true }));
    });
    cy.get('input[aria-label="Meta de Ações nacionais"]').should("have.value", "4");
    cy.contains("button", "Salvar metas").should("be.disabled");
    cy.get('input[aria-label="Meta de Ações internacionais"]').clear().type("1");
    cy.contains("button", "Salvar metas").should("be.enabled").click();
    cy.contains("Metas salvas.").should("be.visible");
    cy.reload();
    cy.waitForHydration();
    cy.get("#portfolio-tab-targets").click();
    cy.get('input[aria-label="Meta de Ações nacionais"]').should("have.value", "4");
    cy.get('input[aria-label="Meta de Ações internacionais"]').should("have.value", "1");
    cy.get('#portfolio-panel-targets [role="img"]').should("have.attr", "aria-label", "Gráfico de distribuição. Total 100%");
  });
});
