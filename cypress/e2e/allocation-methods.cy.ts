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
  it("mantém o resultado até Calcular e grava somente as compras confirmadas", () => {
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBalancedAllocationPortfolio", { email }));
    cy.visit("/carteira"); cy.waitForHydration();
    cy.contains("button", /^Aportar$/).click();
    cy.get("#contribution-value").type("{selectall}450");
    cy.contains("button", "Calcular").click();
    const table = 'table[aria-label="Sugestões de investimento"]';
    cy.get(table).find("tbody tr").should("have.length", 3);
    cy.get<string>("@testUserEmail").then((email) => cy.task("getPendingContributionCount", { email }).should("equal", 0));
    cy.get("#contribution-value").type("{selectall}1000");
    cy.get("#contribution-scope").select("BRL_ONLY");
    cy.get("#contribution-use-full-amount").check();
    cy.get('select[aria-label="Moeda do aporte"]').select("USD");
    cy.get(table).contains("tr", "BALANCE2").should("contain.text", "90,00");
    cy.get('select[aria-label="Moeda do aporte"]').select("BRL");
    cy.contains("button", "Metas").click();
    cy.contains("button", /^Aportar$/).click();
    for (const ticker of ["BALANCE2", "BALANCE3", "BALANCE5"]) {
      cy.get(table).contains("tr", ticker).contains("button", "Aportar").click();
      cy.get("#contribution-unit-price").type("1");
      cy.get('[role="dialog"]').contains("button", /^Aportar$/).click();
      cy.get('[role="dialog"]').should("not.exist");
      cy.get(table).contains("tr", ticker).should("contain.text", "Aporte registrado");
      cy.get(table).find("tbody tr").should("have.length", 3);
      cy.contains("A carteira mudou").should("not.exist");
      cy.get<string>("@testUserEmail").then((email) => cy.task("getPendingContributionCount", { email }).should("equal", 0));
    }
    cy.contains("button", "Calcular").click();
    cy.get(table).should("not.contain.text", "Aporte registrado").contains("tr", "BALANCE2").should("contain.text", "200,00");
  });
});
