describe("gestor financeiro inspirado no AUVP", () => {
  it("persiste perfil, conta manual, tags, transações, metas e orçamento entre rotas", () => {
    cy.registerAndLogin();

    cy.contains("a", "Perfil").click();
    cy.contains("label", "Renda Mensal").find("input").clear().type("9000");
    cy.contains("button", "Salvar").click();
    cy.contains("Perfil atualizado.").should("be.visible");

    cy.contains("a", "Contas").click();
    cy.contains("button", "Nova conta").click();
    cy.contains("button", "Inserir saldo manualmente").click();
    cy.contains("button", "Conta bancária").click();
    cy.contains("label", "Nome da conta").find("input").type("Conta de testes");
    cy.contains("label", "Banco / Instituição").find("input").type("Banco Cypress");
    cy.contains("label", /^Saldo$/).find("input").clear().type("1000");
    cy.get('[role="dialog"]').contains("button", "Adicionar").click();
    cy.contains("Conta de testes").should("be.visible");

    cy.contains("a", "Tags").click();
    cy.contains("button", "Criar Tag").click();
    cy.get('[role="dialog"]').contains("label", "Nome").find("input").type("Teste Cypress");
    cy.get('[role="dialog"]').contains("button", "Salvar").click();
    cy.contains("Teste Cypress").should("be.visible");

    cy.contains("a", "Transações").click();
    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("button", "Entrada").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Renda de teste");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("9000");
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();
    cy.contains("Renda de teste").should("be.visible");

    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Despesa de teste");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("100");
    cy.get('[role="dialog"]').contains("label", "Meta").find("select").select("FIXED_COSTS");
    cy.get('[role="dialog"]').contains("button", "Teste Cypress").click();
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();
    cy.contains("Despesa de teste").should("be.visible");

    cy.contains("a", "Metas").click();
    cy.contains("Alocado").parent().should("contain.text", "100");
    cy.contains("Renda mensal").parent().should("contain.text", "9.000");

    cy.contains("a", "Orçamento").click();
    cy.contains("Sua Renda").parent().should("contain.text", "9.000");
    cy.contains("Gastos do Mês").parent().should("contain.text", "100");
    cy.contains(/100,00/).should("be.visible");

    cy.contains("a", "Painel").click();
    cy.contains("Receitas").parent().should("contain.text", "9.000");
    cy.contains("a", "Transações").click();
    cy.contains("Renda de teste").should("be.visible");
    cy.contains("Despesa de teste").should("be.visible");
  });
});
