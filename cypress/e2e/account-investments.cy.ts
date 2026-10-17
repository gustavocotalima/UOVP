describe("Saldo de conta como investimento", () => {
  for (const viewport of ["desktop", "mobile"] as const) {
    it(`revisa e acompanha saldo sem duplicar lançamentos (${viewport})`, () => {
      cy.viewport(viewport === "mobile" ? 390 : 1440, viewport === "mobile" ? 844 : 1000);
      cy.registerAndLogin();
      cy.visit("/contas");
      cy.waitForHydration();
      cy.contains("button", "Nova conta").click();
      cy.contains("button", "Inserir saldo manualmente").click();
      cy.contains("button", "Conta bancária").click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains("Classificar saldo como investimento").should("not.exist");
        cy.contains("label", "Nome da conta").find("input").type("Conta remunerada Cypress");
        cy.contains("label", "Saldo atual").find("input").clear().type("1000");
        cy.contains("button", "Adicionar").click();
      });
      cy.contains("Conta adicionada.").should("be.visible");
      cy.get('button[aria-label="Editar conta"]:visible').first().click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains("label", "Classificar saldo como investimento").find('input[type="checkbox"]').should("not.be.checked").check();
        cy.contains("O valor continuará incluído no Saldo em conta").should("be.visible");
        cy.contains("button", "Salvar alterações").click();
      });
      cy.contains("Conta atualizada.").should("be.visible");
      cy.visit("/carteira");
      cy.waitForHydration();
      cy.contains("1 investimento(s) precisam de revisão").should("be.visible");
      cy.contains("button", "Revisar integração").click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains("Classificar saldo da conta").should("be.visible");
        cy.get("#review-instrument").should("have.value", "FIXED_INCOME");
        cy.get("#review-exposure").should("have.value", "FIXED_INCOME");
        cy.get("#review-family").select("PAYMENT_ACCOUNT_RESERVES");
        cy.get("#review-indexation").select("OTHER");
        cy.get("#review-score").type("{selectall}8");
        cy.get("#account-review-custom").should("have.value", "Saldo de conta remunerado");
        cy.get("#account-review-rate-format").should("have.value", "");
        cy.contains("button", "Integrar ao diagrama").click();
      });
      cy.contains("Investimento integrado ao diagrama.").should("be.visible");
      cy.contains("1 investimento(s) precisam de revisão").should("not.exist");

      if (viewport === "desktop") {
        cy.contains("button", "Metas").click();
        cy.get('input[aria-label^="Meta de "]').each(($input) => cy.wrap($input).clear().type("0"));
        cy.get('input[aria-label="Meta de Renda fixa"]').type("{selectall}100");
        cy.contains("button", "Salvar metas").click();
        cy.contains("Metas salvas.").should("be.visible");
        cy.contains("button", "Aportar").click();
        cy.contains("button", "Calcular").click();
        cy.get('table[aria-label="Sugestões de investimento"]').contains("tr", "CONTA-PGTO-OUTRO").contains("button", "Aportar").click();
        cy.get('[role="dialog"]').within(() => {
          cy.contains("Faça o depósito fora deste fluxo").should("be.visible");
          cy.contains("button", "Planejar aporte").click();
        });
        cy.contains("Aporte planejado").should("be.visible");
      }

      cy.visit("/contas");
      cy.waitForHydration();
      cy.get('button[aria-label="Editar conta"]:visible').first().click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains("Incluído na Carteira").scrollIntoView().should("be.visible");
        cy.contains("label", "Saldo atual").find("input").should("have.value", "1000").clear().type("1300");
        cy.contains("button", "Salvar alterações").click();
      });
      cy.contains("Conta atualizada.").should("be.visible");
      cy.visit("/carteira");
      cy.waitForHydration();
      cy.get('button[aria-label^="Expandir "]:visible').first().click();
      cy.contains(":visible", "Saldo da conta · Conta remunerada Cypress").should("be.visible");
      cy.contains(":visible", /1\.300,00/).should("be.visible");
      cy.contains("button:visible", "Remover da Carteira").click();
      cy.contains("button:visible", "Remover da Carteira").should("not.exist");
      cy.visit("/contas");
      cy.waitForHydration();
      cy.get('button[aria-label="Editar conta"]:visible').first().click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains("label", "Saldo atual").find("input").should("have.value", "1300");
        cy.contains("label", "Classificar saldo como investimento").find('input[type="checkbox"]').should("not.be.checked").check();
        cy.contains("button", "Salvar alterações").click();
      });
      cy.contains("Conta atualizada.").should("be.visible");
      cy.visit("/carteira");
      cy.waitForHydration();
      cy.contains("1 investimento(s) precisam de revisão").should("not.exist");
      cy.contains(":visible", "CONTA-PGTO-OUTRO").should("be.visible");
      cy.visit("/transacoes");
      cy.waitForHydration();
      cy.contains("Um total de 0 transações encontradas").should("be.visible");
    });
  }
});
