describe("sistema de cálculo de aportes", () => {
  beforeEach(() => { cy.registerAndLogin(); });
  it("começa no Melhorado, persiste o Cerrado e permite voltar ao padrão", () => {
    cy.visit("/configuracoes"); cy.waitForHydration();
    cy.get("#allocation-method").should("have.value", "IMPROVED");
    cy.get("#allocation-method").select("CERRADO");
    cy.contains("Sistema atualizado.").should("be.visible");
    cy.reload(); cy.waitForHydration();
    cy.get("#allocation-method").should("have.value", "CERRADO").select("IMPROVED");
    cy.contains("Sistema atualizado.").should("be.visible");
    cy.reload(); cy.waitForHydration();
    cy.get("#allocation-method").should("have.value", "IMPROVED");
  });
});
