describe("quantidade temporária de investimentos Pluggy", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedPluggyQuantityOverride", { email }));
  });

  function openWithdrawnInvestment() {
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "Mostrar vendidos").click();
    cy.contains("button", "ITUB3").click();
    cy.contains("button", "Editar informações").click();
  }

  function saveQuantity(value: string) {
    cy.get("#metadata-quantity").should("be.disabled").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
    });
    cy.get("#metadata-quantity").should("be.enabled").clear().type(value);
    cy.contains("button", "Salvar informações").click();
    cy.get("#metadata-quantity", { timeout: 15_000 }).should("not.exist");
  }

  function assertStoredQuantity(quantity: string, includedInTotals: boolean) {
    cy.get<string>("@testUserEmail").then((email) => {
      cy.task("getPluggyQuantityOverrideState", { email }).should("include", {
        overrideQuantity: quantity,
        quantity,
        includedInTotals,
        providerQuantity: "0",
        providerStatus: "TOTAL_WITHDRAWAL",
        operationCount: 1,
        operationQuantity: "110",
      });
    });
  }

  it("permite corrigir a posição, persiste no reload e restaura o zero da instituição", () => {
    openWithdrawnInvestment();
    cy.get('[role="dialog"]').contains("Nenhuma movimentação será criada ou alterada").should("be.visible");
    saveQuantity("110");
    cy.contains("button", "ITUB3").should("contain.text", "Quantidade temporária");
    cy.contains("dt", "Quantidade usada na Carteira").next("dd").should("have.text", "110");
    assertStoredQuantity("110", true);

    cy.visit("/carteira");
    cy.waitForHydration();
    cy.contains("tr", "ITUB3").should("contain.text", "110");
    cy.contains("R$ 5.500,00").should("be.visible");

    cy.reload();
    cy.waitForHydration();
    cy.contains("tr", "ITUB3").should("contain.text", "110");
    assertStoredQuantity("110", true);

    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "ITUB3").should("contain.text", "Quantidade temporária").click();
    cy.contains("button", "Editar informações").click();
    cy.get("#metadata-quantity").should("have.value", "110").parent().within(() => {
      cy.get('input[type="checkbox"]').should("be.checked").uncheck();
    });
    cy.get("#metadata-quantity").should("be.disabled").and("have.value", "0");
    cy.contains("button", "Salvar informações").click();
    cy.get("#metadata-quantity", { timeout: 15_000 }).should("not.exist");
    cy.get<string>("@testUserEmail").then((email) => {
      cy.task("getPluggyQuantityOverrideState", { email }).should("include", {
        overrideQuantity: null,
        quantity: "0",
        includedInTotals: false,
        providerQuantity: "0",
        operationCount: 1,
      });
    });
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.contains("tr", "ITUB3").should("not.exist");
  });

  it("mantém o editor utilizável em celular e aceita zero como retirada temporária dos totais", () => {
    cy.viewport(390, 844);
    openWithdrawnInvestment();
    cy.get("#metadata-quantity").should("be.visible");
    saveQuantity("110");
    assertStoredQuantity("110", true);
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get('[data-testid="mobile-asset-card"]').contains("ITUB3").should("be.visible");

    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "ITUB3").click();
    cy.contains("button", "Editar informações").click();
    cy.get("#metadata-quantity").should("have.value", "110").clear().type("0");
    cy.contains("button", "Salvar informações").click();
    cy.get("#metadata-quantity", { timeout: 15_000 }).should("not.exist");
    assertStoredQuantity("0", false);
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(390);
    });
  });
});
