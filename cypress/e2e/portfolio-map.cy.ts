describe("mapa da carteira", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.visit("/carteira");
    cy.contains("button", "Mapa").click();
  });

  it("reproduz o mapa mundial e o painel detalhado da AUVP", () => {
    cy.contains("h2", "Mapa").should("be.visible");
    cy.contains("Verifique a baixo a saúde financeira de cada Pais.").should("be.visible");
    cy.get('[aria-label="Mapa de risco por país"] path.leaflet-interactive').should(($countries) => {
      expect($countries.length).to.be.greaterThan(150);
    });
    cy.get('[data-testid="country-info-panel"]').should("contain", "Selecione um país no mapa para ver informações detalhadas");

    cy.get('input[aria-label="Buscar por país ou índice"]').type("Brazil{enter}");
    cy.get('path[aria-label="Brasil"]').should("have.attr", "fill", "#f59e0b").click({ force: true });

    cy.get('[data-testid="country-info-panel"]').should("contain", "Brasil").and("contain", "Médio Risco").and("contain", "Ibovespa").and("contain", "BB-");
    cy.get('[data-testid="country-info-panel"]').contains("button", "Empresas").click();
    cy.get('[data-testid="country-info-panel"]').should("contain", "Petrobras").and("contain", "PETR4 • Energia");
    cy.get('[data-testid="country-info-panel"]').contains("button", "ETFs").click();
    cy.get('[data-testid="country-info-panel"]').should("contain", "EWZ").and("contain", "ETF Americano");
  });
});
