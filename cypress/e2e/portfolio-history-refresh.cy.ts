describe("invalidação das movimentações da carteira", () => {
  it("recarrega posições expandidas após refresh sem duplicar requests das views responsivas", () => {
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedPluggyQuantityOverride", { email }));
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "Mostrar vendidos").click();
    cy.contains("button", "ITUB3").click();
    cy.contains("button", "Editar informações").click();
    cy.get("#metadata-quantity").parent().find('input[type="checkbox"]').check();
    cy.get("#metadata-quantity").clear().type("110");
    cy.contains("button", "Salvar informações").click();
    cy.get('[role="dialog"]').should("not.exist");

    let requests = 0;
    cy.intercept("GET", "/api/portfolio/holdings/*/transactions*", (request) => {
      requests += 1;
      request.reply({
        page: 1, pageSize: 25, total: 1, averagePricePaid: "40", averagePriceCoverage: 1,
        transactions: [{
          id: "history-row", description: requests === 1 ? "Histórico inicial" : "Histórico atualizado",
          type: "BUY", movementType: null, quantity: "110", value: "40", amount: "4400",
          netAmount: null, agreedRate: null, date: "2026-07-01T12:00:00Z", tradeDate: null,
        }],
      });
    }).as("holdingHistory");
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get('button[aria-label^="Expandir "]:visible').click();
    cy.wait("@holdingHistory");
    cy.contains(":visible", "Histórico inicial").should("be.visible");
    cy.contains("button:visible", "Informações").click();
    cy.get("#metadata-quantity").clear().type("120");
    cy.contains("button", "Salvar informações").click();
    cy.get('[role="dialog"]').should("not.exist");
    cy.wait("@holdingHistory");
    cy.contains(":visible", "Histórico atualizado").should("be.visible");
    cy.contains(":visible", "Histórico inicial").should("not.exist");
    cy.get('button[aria-label^="Recolher "]:visible').should("have.attr", "aria-expanded", "true");
    cy.then(() => expect(requests).to.equal(2));
  });
});
