describe("aportes com quantidade temporária Open Finance", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedPluggyQuantityOverride", { email, activeQuantity: 100 }));
  });

  function record(quantity: string, value: string) {
    cy.contains("button", /^Aportar$/).first().click();
    cy.get("#contribution-value").type(`{selectall}${value}`);
    cy.contains("button", "Calcular").click();
    cy.get('table[aria-label="Sugestões de investimento"]:visible, [data-testid="mobile-contribution-card"]:visible').contains("button", "Aportar").click();
    cy.get("#contribution-institution").should("not.have.value", "");
    cy.get("#contribution-quantity").type(`{selectall}${quantity}`);
    cy.get("#contribution-unit-price").type("50");
    cy.contains("button", "Registrar aporte").click();
    cy.contains("A quantidade já inclui a compra").should("be.visible");
  }

  it("acumula compras, persiste no reload e mantém o provedor intacto", () => {
    cy.visit("/carteira"); cy.waitForHydration();
    record("10", "500"); record("5", "250");
    cy.reload(); cy.waitForHydration();
    cy.contains("tr", "ITUB3").should("contain.text", "115").find('button[aria-expanded="false"]').click();
    cy.get('[data-pending-contribution]:visible').should("have.length", 2);
    cy.get<string>("@testUserEmail").then((email) => cy.task("getPluggyQuantityOverrideState", { email }).should("include", { quantity: "115", overrideQuantity: "115", providerQuantity: "100" }));
  });

  it("permite manter temporariamente e depois escolher a instituição no celular", () => {
    cy.viewport(390, 844); cy.visit("/carteira"); cy.waitForHydration();
    record("10", "500");
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedContributionQuantityConflict", { email, quantity: 108 }));
    cy.reload(); cy.waitForHydration();
    cy.get('section[aria-label="Revisão de quantidades da instituição"]').within(() => {
      cy.contains("Quantidade com aportes em uso").should("be.visible");
      cy.contains("button", "Manter quantidade manual").click();
    });
    cy.get('section[aria-label="Revisão de quantidades da instituição"]').should("not.exist");
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedContributionQuantityConflict", { email, quantity: 109 }));
    cy.reload(); cy.waitForHydration();
    cy.contains("button", "Usar quantidade da instituição").click();
    cy.get('section[aria-label="Revisão de quantidades da instituição"]').should("not.exist");
    cy.get<string>("@testUserEmail").then((email) => cy.task("getPluggyQuantityOverrideState", { email }).should("include", { quantity: "109", overrideQuantity: null, providerQuantity: "109" }));
    cy.document().then((document) => expect(document.documentElement.scrollWidth).to.be.at.most(390));
  });
});
