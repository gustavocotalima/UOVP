describe("autenticação e navegação", () => {
  it("bloqueia POST na raiz sem alterar o redirecionamento normal", () => {
    cy.request({ method: "POST", url: "/", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.equal(405);
      expect(response.headers.allow).to.equal("GET, HEAD");
    });
    cy.visit("/");
    cy.location("pathname").should("eq", "/login");
  });

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
      cy.contains("a", label).filter(":visible").click();
      cy.location("pathname").should("eq", path);
    });

    cy.get('a[href="/perfil"]:visible').click();
    cy.location("pathname").should("eq", "/perfil");
    cy.get('a[aria-label="Configurações"]:visible').click();
    cy.location("pathname").should("eq", "/configuracoes");
  });
});
