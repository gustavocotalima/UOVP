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
    cy.get('[role="dialog"]').should("be.visible");
    cy.get("#contribution-institution").should("not.have.value", "");
    cy.get("#contribution-quantity").type(`{selectall}${quantity}`);
    cy.get("#contribution-unit-price").type("50");
    cy.get('[role="dialog"]').contains("button", /^Aportar$/).click();
    cy.contains("A quantidade já inclui a compra").should("not.exist");
    cy.get('[role="dialog"]').should("not.exist");
    cy.contains("Distribuição do investimento").should("be.visible");
    cy.get('table[aria-label="Sugestões de investimento"]:visible, [data-testid="mobile-contribution-card"]:visible').should("contain.text", "Aporte registrado");
  }

  it("abrir o formulário de aporte não registra compra nem descarta o cálculo", () => {
    cy.visit("/carteira"); cy.waitForHydration();
    cy.contains("button", /^Aportar$/).first().click();
    cy.get("#contribution-value").type("{selectall}500");
    cy.contains("button", "Calcular").click();
    cy.get('table[aria-label="Sugestões de investimento"]:visible').contains("button", "Aportar").click();
    cy.get('[role="dialog"]').should("be.visible");
    cy.get("#contribution-unit-price").should("have.value", "");
    cy.contains("A quantidade já inclui a compra").should("not.exist");
    cy.get<string>("@testUserEmail").then((email) => cy.task("getPluggyQuantityOverrideState", { email }).should("include", { quantity: "100", overrideQuantity: null, providerQuantity: "100" }));
  });

  it("acumula compras, persiste no reload e mantém o provedor intacto", () => {
    cy.visit("/carteira"); cy.waitForHydration();
    record("10", "500"); record("5", "250");
    cy.reload(); cy.waitForHydration();
    cy.contains("tr", "ITUB3").should("contain.text", "115").find('button[aria-expanded="false"]').click();
    cy.get('[data-pending-contribution]:visible').should("have.length", 2);
    cy.get<string>("@testUserEmail").then((email) => cy.task("getPluggyQuantityOverrideState", { email }).should("include", { quantity: "115", overrideQuantity: "115", providerQuantity: "100" }));
  });

  it("preserva a prévia e recusa duplicar uma compra já incorporada pela instituição", () => {
    cy.visit("/carteira"); cy.waitForHydration();
    cy.contains("button", /^Aportar$/).first().click();
    cy.get("#contribution-value").type("{selectall}500");
    cy.contains("button", "Calcular").click();
    const table = 'table[aria-label="Sugestões de investimento"]:visible';
    cy.get(table).invoke("text").as("originalPreview");
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedSyncedContributionQuantity", { email, quantity: 110 }));
    cy.get(table).contains("button", "Aportar").click();
    cy.get("#contribution-quantity").type("{selectall}10");
    cy.get("#contribution-unit-price").type("50");
    cy.get('[role="dialog"]').contains("button", /^Aportar$/).click();
    cy.contains("A quantidade desta posição mudou").should("exist");
    cy.get('[role="dialog"]').should("be.visible");
    cy.get<string>("@originalPreview").then((original) => cy.get(table).invoke("text").should("equal", original));
    cy.get<string>("@testUserEmail").then((email) => {
      cy.task("getPluggyQuantityOverrideState", { email }).should("include", { quantity: "110", overrideQuantity: null, providerQuantity: "110" });
      cy.task("getPendingContributionCount", { email }).should("equal", 0);
    });
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
