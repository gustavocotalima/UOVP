describe("gestor financeiro inspirado no AUVP", () => {
  it("persiste perfil, conta manual, tags, transações, metas e orçamento entre rotas", () => {
    cy.registerAndLogin();

    cy.get('a[href="/perfil"]:visible').click();
    cy.contains("label", "Renda Mensal").find("input").clear().type("9000");
    cy.contains("button", "Salvar").click();
    cy.contains("Perfil atualizado.").should("be.visible");

    cy.contains("a", "Contas").filter(":visible").click();
    cy.contains("button", "Nova conta").click();
    cy.contains("button", "Inserir saldo manualmente").click();
    cy.contains("button", "Conta bancária").click();
    cy.contains("label", "Nome da conta").find("input").type("Conta de testes");
    cy.contains("label", "Banco / Instituição").find("input").type("Banco Cypress");
    cy.contains("label", "Saldo atual").find("input").clear().type("1000");
    cy.get('[role="dialog"]').contains("button", "Adicionar").click();
    cy.contains(":visible", "Conta de testes").should("be.visible");

    cy.contains("button", "Nova conta").click();
    cy.contains("button", "Inserir saldo manualmente").click();
    cy.contains("button", "Conta bancária").click();
    cy.contains("label", "Nome da conta").find("input").type("Conta USD");
    cy.contains("label", "Banco / Instituição").find("input").type("Banco Internacional");
    cy.contains("label", "Moeda").find("select").select("USD");
    cy.get('[role="dialog"]').contains("button", "Adicionar").click();
    cy.contains(":visible", "Conta USD").should("be.visible");
    cy.contains(":visible", /US\$\s*0,00/).should("be.visible");

    cy.contains("a", "Tags").filter(":visible").click();
    cy.contains("button", "Criar Tag").click();
    cy.get('[role="dialog"]').contains("label", "Nome").find("input").type("Teste Cypress");
    cy.get('[role="dialog"]').contains("button", "Salvar").click();
    cy.contains(":visible", "Teste Cypress").should("be.visible");

    cy.contains("a", "Transações").filter(":visible").click();
    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("button", "Entrada").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Renda de teste");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes · BRL");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("9000");
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();
    cy.contains(":visible", "Renda de teste").should("be.visible");

    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Despesa de teste");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes · BRL");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("100");
    cy.get('[role="dialog"]').contains("label", "Meta").find("select").select("FIXED_COSTS");
    cy.get('[role="dialog"]').contains("summary", "Sem tags").click();
    cy.get('[role="dialog"]').contains("label", "Teste Cypress").find("input").check();
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();
    cy.contains(":visible", "Despesa de teste").should("be.visible");

    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("button", "Entrada").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Dividendo reinvestido");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes · BRL");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("540.60");
    cy.get('[role="dialog"]').contains("label", "Meta").find("select").select("FINANCIAL_FREEDOM");
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();

    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Reinvestimento");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de testes · BRL");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("540.60");
    cy.get('[role="dialog"]').contains("label", "Meta").find("select").select("FINANCIAL_FREEDOM");
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();

    cy.contains("a", "Metas").filter(":visible").click();
    cy.contains("Alocado").parent().should("contain.text", "100");
    cy.contains("Renda mensal").parent().should("contain.text", "9.000");

    cy.contains("a", "Orçamento").filter(":visible").click();
    cy.contains("Entradas líquidas").parent().should("contain.text", "9.000");
    cy.contains("Despesas líquidas").parent().should("contain.text", "100");
    cy.contains("Saldo Restante").parent().should("contain.text", "8.900");
    cy.contains(/100,00/).should("be.visible");

    cy.get('[data-budget-category="FIXED_COSTS"]').contains("button", "1 transações").click();
    cy.get('[role="dialog"]').contains("Despesa de teste").should("be.visible");
    cy.get('[role="dialog"]').find('button[aria-label="Editar transação"]').click();
    cy.get('[role="dialog"]').last().contains("label", "Meta").find("select").select("COMFORT");
    cy.get('[role="dialog"]').last().contains("button", "Salvar alterações").click();
    cy.get('[role="dialog"]').should("contain", "Custos fixos").and("not.contain", "Despesa de teste");
    cy.get('[role="dialog"]').find('button[aria-label="Fechar"]').click();
    cy.get('[data-budget-category="FIXED_COSTS"]')
      .contains("p", "Realizado líquido")
      .parent()
      .should("contain.text", "0,00");
    cy.get('[data-budget-category="COMFORT"]')
      .contains("p", "Realizado líquido")
      .parent()
      .should("contain.text", "100,00");

    cy.contains("a", "Painel").filter(":visible").click();
    cy.contains("Entradas líquidas").parent().should("contain.text", "9.000");
    cy.contains("Despesas líquidas").parent().should("contain.text", "100");
    cy.contains("Resultado do período").parent().should("contain.text", "8.900");
    cy.contains("a", "Transações").filter(":visible").click();
    cy.contains("Entradas").parent().should("contain.text", "9.540,60");
    cy.contains("Saídas").parent().should("contain.text", "640,60");
    cy.contains(":visible", "Renda de teste").should("be.visible");
    cy.contains(":visible", "Despesa de teste").should("be.visible");
  });

  it("usa a correção manual como novo marco e aplica somente transações posteriores", () => {
    cy.registerAndLogin();

    cy.contains("a", "Contas").filter(":visible").click();
    cy.contains("button", "Nova conta").click();
    cy.contains("button", "Inserir saldo manualmente").click();
    cy.contains("button", "Conta bancária").click();
    cy.contains("label", "Nome da conta").find("input").type("Conta de saldo");
    cy.contains("label", "Banco / Instituição").find("input").type("Banco de teste");
    cy.contains("label", "Saldo atual").find("input").clear().type("100");
    cy.get('[role="dialog"]').contains("button", "Adicionar").click();

    cy.contains("a", "Transações").filter(":visible").click();
    cy.contains("button", "Nova transação").click();
    cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type("Saída histórica");
    cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de saldo · BRL");
    cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type("25");
    cy.get('[role="dialog"] [role="switch"][aria-label="Atualizar saldo da conta"]')
      .should("have.attr", "aria-checked", "true")
      .click()
      .should("have.attr", "aria-checked", "false");
    cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();

    cy.contains("a", "Contas").filter(":visible").click();
    cy.get('button[aria-label="Editar conta"]').click();
    cy.get('[role="dialog"]').contains("label", "Saldo atual").find("input").clear().type("68.38");
    cy.get('[role="dialog"]').contains("button", "Salvar").click();

    cy.contains("a", "Transações").filter(":visible").click();
    for (const [description, kind, amount] of [
      ["Entrada posterior", "INCOME", "490"],
      ["Saída posterior A", "EXPENSE", "2.50"],
      ["Saída posterior B", "EXPENSE", "7.73"],
    ] as const) {
      cy.contains("button", "Nova transação").click();
      if (kind === "INCOME") cy.get('[role="dialog"]').contains("button", "Entrada").click();
      cy.get('[role="dialog"]').contains("label", "Descrição").find("input").type(description);
      cy.get('[role="dialog"]').contains("label", "Conta").find("select").select("Conta de saldo · BRL");
      cy.get('[role="dialog"]').contains("label", "Quantia").find("input").type(amount);
      cy.get('[role="dialog"] [role="switch"][aria-label="Atualizar saldo da conta"]')
        .should("have.attr", "aria-checked", "true");
      cy.get('[role="dialog"]').contains("button", "Adicionar transação").click();
    }

    cy.contains("a", "Contas").filter(":visible").click();
    cy.contains("p", "Saldo disponível").parent().should("contain.text", "R$ 548,15");
  });
});
