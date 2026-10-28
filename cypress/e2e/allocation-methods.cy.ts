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
  it("distribui R$ 450 pelas notas 2/3/5 sem o aviso de comprovação global", () => {
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBalancedAllocationPortfolio", { email }));
    cy.visit("/carteira"); cy.waitForHydration();
    cy.get('[data-assets-panel-hydrated="true"]').should("be.visible");
    cy.contains("button", "Aportar").click();
    cy.get("#contribution-value").type("{selectall}450").should("have.value", "450");
    cy.contains("button", "Calcular").click();
    cy.get('table[aria-label="Sugestões de investimento"]').within(() => {
      cy.contains("tr", "BALANCE2").should("contain.text", "90,00");
      cy.contains("tr", "BALANCE3").should("contain.text", "135,00");
      cy.contains("tr", "BALANCE5").should("contain.text", "225,00");
    });
    cy.contains("Limite de cálculo atingido").should("not.exist");
  });
});
