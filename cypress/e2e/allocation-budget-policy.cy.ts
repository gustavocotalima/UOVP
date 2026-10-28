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
      cy.get("#contribution-use-full-amount").should("not.exist");
      cy.contains("button", "Calcular").should(($button) => {
        const bounds = $button[0].getBoundingClientRect();
        const card = $button.closest(".rounded-2xl")[0].getBoundingClientRect();
        expect(bounds.left).to.be.at.least(card.left);
        expect(bounds.right).to.be.at.most(card.right);
      });
      cy.get("#contribution-value").type("{selectall}1000");
      cy.get("#contribution-scope").select("BRL_ONLY");
      cy.get("#contribution-use-full-amount").should("be.visible").and("not.be.checked");
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
      cy.get("#contribution-scope").select("ALL_ASSETS");
      cy.get("#contribution-use-full-amount").should("not.exist");
      cy.get('[data-testid="mobile-contribution-card"]').should("not.exist");
      cy.get("#contribution-scope").select("BRL_ONLY");
      cy.get("#contribution-use-full-amount").should("not.be.checked");
      cy.get("#contribution-use-full-amount").check();
      cy.get('[aria-label="Moeda do aporte"]').select("USD");
      cy.get("#contribution-scope").should("have.value", "USD_ONLY");
      cy.get("#contribution-use-full-amount").should("be.visible").and("not.be.checked");
      cy.get("#contribution-use-full-amount").check();
      cy.get('[aria-label="Moeda do aporte"]').select("BRL");
      cy.get("#contribution-use-full-amount").should("not.exist");
      cy.reload(); cy.waitForHydration(); cy.contains("button", "Aportar").click();
      cy.get("#contribution-use-full-amount").should("not.exist");
      cy.get("#contribution-scope").select("BRL_ONLY");
      cy.get("#contribution-use-full-amount").should("not.be.checked");
    });
  }

  it("mantém os controles alinhados e a explicação no tooltip em ambos os temas", () => {
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 390, 768, 1200, 1851]) {
        cy.viewport(width, 900);
        cy.window().then((win) => win.localStorage.setItem("theme", theme));
        cy.visit("/carteira"); cy.waitForHydration();
        cy.contains("button", "Aportar").click();
        cy.get("html").should("have.class", theme);
        cy.get("#contribution-use-full-amount").should("not.exist");
        cy.get("#contribution-scope").select("BRL_ONLY");
        cy.get('[role="tooltip"]').should("not.exist");
        cy.get('[aria-label="Sobre usar todo o aporte"]').focus();
        cy.get('[role="tooltip"]').should("be.visible").and("contain.text", "Arredondamentos podem deixar sobra.");
        cy.get('[aria-label="Sobre usar todo o aporte"]').type("{esc}");
        cy.get('[role="tooltip"]').should("not.exist");
        cy.get('[aria-label="Sobre usar todo o aporte"]').click();
        cy.get('[role="tooltip"]').should("be.visible").and(($tooltip) => {
          const bounds = $tooltip[0].getBoundingClientRect();
          expect(bounds.left).to.be.at.least(0);
          expect(bounds.right).to.be.at.most(width);
        });
        cy.get("#contribution-value").focus();
        cy.get('[role="tooltip"]').should("not.exist");
        cy.get('[data-testid="contribution-form"]').should(($form) => {
          const form = $form[0];
          expect(form.scrollWidth).to.be.at.most(form.clientWidth);
          for (const control of form.querySelectorAll("input, select, button")) {
            const bounds = control.getBoundingClientRect();
            expect(bounds.left).to.be.at.least(form.getBoundingClientRect().left);
            expect(bounds.right).to.be.at.most(form.getBoundingClientRect().right);
          }
          const value = form.querySelector("#contribution-value")!.getBoundingClientRect();
          const scope = form.querySelector("#contribution-scope")!.getBoundingClientRect();
          const actions = form.querySelector('[data-testid="contribution-actions"]')!;
          const calculate = actions.querySelector("button")!.getBoundingClientRect();
          const checkbox = actions.querySelector('input[type="checkbox"]')!.getBoundingClientRect();
          expect(checkbox.left).to.be.greaterThan(calculate.right);
          expect(Math.abs((checkbox.top + checkbox.bottom) / 2 - (calculate.top + calculate.bottom) / 2)).to.be.at.most(1);
          if (getComputedStyle(form).gridTemplateColumns.split(" ").length === 3) {
            expect(Math.abs(value.bottom - scope.bottom)).to.be.at.most(1);
            expect(Math.abs(scope.bottom - calculate.bottom)).to.be.at.most(1);
            expect(scope.left - value.right).to.be.lessThan(130);
            expect(calculate.left - scope.right).to.be.lessThan(25);
          }
        });
        if (Cypress.env("captureContributionLayout")) {
          cy.get('[data-testid="contribution-form"]').parent().screenshot(`contribution-form-${theme}-${width}`);
        }
      }
    }
  });
});
