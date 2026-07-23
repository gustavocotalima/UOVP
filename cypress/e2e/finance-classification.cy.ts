describe("classificação automática de transações Pluggy", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => {
      cy.task("seedFinanceClassification", { email });
    });
    cy.visit("/transacoes");
  });

  it("exibe classificações, pendências e explicações do provedor", () => {
    cy.contains("tr", "Mercado classificado")
      .should("contain", "Custos fixos")
      .and("contain", "Alimentação")
      .and("contain", "Pluggy");

    cy.contains("1 transações precisam de classificação").should("be.visible");
    cy.contains("button", "Revisar agora").click();
    cy.contains("tr", "PIX sem classificação").should("be.visible");
    cy.contains("tr", "PIX entre minhas contas").should("not.exist");

    cy.contains("tr", "PIX sem classificação")
      .find('button[aria-label="Ações da transação"]')
      .click();
    cy.contains("button", "Ver detalhes").click();
    cy.get('[role="dialog"]')
      .should("contain", "Transfer - PIX")
      .and("contain", "Pessoa terceira")
      .and("contain", "PIX")
      .and("contain", "Não classificada");
  });

  it("aprende uma regra exata e reaplica somente em classificações não manuais", () => {
    cy.on("window:confirm", () => true);
    cy.contains("tr", "Loja semelhante A")
      .find("select")
      .first()
      .select("GOALS");
    cy.contains("Meta atualizada e regra pessoal criada.").should("be.visible");
    cy.contains("tr", "Loja semelhante A").should("contain", "Metas").and("contain", "Manual");
    cy.contains("tr", "Loja semelhante B").should("contain", "Metas").and("contain", "Regra pessoal");

    cy.contains("a", "Tags").click();
    cy.contains("Regras automáticas").should("be.visible");
    cy.contains("tr", "12.345.678/0001-90").should("contain", "Metas").and("contain", "Ativa");

    cy.contains("tr", "12.345.678/0001-90")
      .find('button[aria-label="Editar regra"]')
      .click();
    cy.get('[role="dialog"]').contains("label", "Regra ativa").find("input").uncheck();
    cy.get('[role="dialog"]').contains("button", "Salvar regra").click();
    cy.contains("Regra automática atualizada.").should("be.visible");

    cy.contains("a", "Transações").click();
    cy.contains("tr", "Loja semelhante A").should("contain", "Metas").and("contain", "Manual");
    cy.contains("tr", "Loja semelhante B").should("contain", "Conforto").and("contain", "Pluggy");
  });
});
