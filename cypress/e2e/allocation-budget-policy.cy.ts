describe("política de orçamento dos aportes", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedScopedBudgetPortfolio", { email }));
  });
  for (const method of ["IMPROVED", "CERRADO"]) {
    it(`${method}: limita às metas por padrão e permite usar todo o aporte`, () => {
      if (method === "CERRADO") {
        cy.visit("/configuracoes"); cy.waitForHydration();
        cy.get("#allocation-method").select(method); cy.contains("Sistema atualizado.").should("be.visible");
      }
      cy.visit("/carteira"); cy.waitForHydration();
      cy.contains("button", "Aportar").click();
      cy.get("#contribution-use-full-amount").should("not.be.checked");
      cy.contains("button", "Calcular").should(($button) => {
        const bounds = $button[0].getBoundingClientRect();
        const card = $button.closest(".rounded-2xl")[0].getBoundingClientRect();
        expect(bounds.left).to.be.at.least(card.left);
        expect(bounds.right).to.be.at.most(card.right);
      });
      cy.get("#contribution-value").type("{selectall}1000");
      cy.get("#contribution-scope").select("BRL_ONLY");
      cy.contains("button", "Calcular").click();
      cy.get('table[aria-label="Sugestões de investimento"]').within(() => {
        cy.contains("tr", "BUDGETBRL").should("contain.text", "411");
        cy.contains("EXCLUDED").should("not.exist");
      });
      cy.contains("Parte do aporte ficou disponível para preservar as metas.").should("be.visible");
      cy.get("#contribution-use-full-amount").check();
      cy.get('table[aria-label="Sugestões de investimento"]').should("not.exist");
      cy.get("#contribution-value").should("have.value", "1000");
      cy.contains("button", "Calcular").click();
      cy.get('table[aria-label="Sugestões de investimento"]').within(() => {
        cy.contains("tr", "BUDGETBRL").should("contain.text", "1.000,00");
        cy.contains("EXCLUDED").should("not.exist");
      });
      // The table may scroll horizontally, but its full height belongs to the page.
      cy.get('table[aria-label="Sugestões de investimento"]').parent().should(($container) => {
        expect(getComputedStyle($container[0]).maxHeight).to.equal("none");
        expect($container[0].scrollHeight).to.be.at.most($container[0].clientHeight + 1);
      });
      cy.viewport(390, 844);
      cy.get("#contribution-use-full-amount").should("be.visible").and("be.checked");
      cy.get('[data-testid="mobile-contribution-card"]').should("be.visible").and("contain.text", "1.000,00");
      cy.reload(); cy.waitForHydration(); cy.contains("button", "Aportar").click();
      cy.get("#contribution-use-full-amount").should("not.be.checked");
    });
  }
});
