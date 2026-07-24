describe("autenticação e navegação", () => {
  it("cria um usuário e acessa todos os itens do menu lateral", () => {
    cy.registerAndLogin();
    const routes = [
      ["Painel", "/home"],
      ["Orçamento", "/orcamento-domestico"],
      ["Metas", "/metas"],
      ["Contas", "/contas"],
      ["Faturas", "/faturas"],
      ["Transações", "/transacoes"],
      ["Tags", "/tags"],
      ["Carteira", "/carteira"],
      ["Open Finance", "/open-finance"],
      ["Ferramentas", "/ferramentas"],
    ];
    routes.forEach(([label, path]) => {
      cy.contains("a", label).click();
      cy.location("pathname").should("eq", path);
    });

    cy.get('a[href="/perfil"]').click();
    cy.location("pathname").should("eq", "/perfil");
    cy.get('a[aria-label="Configurações"]').click();
    cy.location("pathname").should("eq", "/configuracoes");
  });
});
