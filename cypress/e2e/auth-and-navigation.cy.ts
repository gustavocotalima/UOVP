describe("autenticação e navegação", () => {
  it("cria um usuário e acessa todos os itens do menu lateral", () => {
    cy.registerAndLogin();
    const routes = [
      ["Home", "/home"],
      ["Carteira", "/carteira"],
      ["Orçamento Doméstico", "/orcamento-domestico"],
      ["Ferramentas", "/ferramentas"],
      ["FAQ", "/faq"],
    ];
    routes.forEach(([label, path]) => {
      cy.contains("a", label).click();
      cy.location("pathname").should("eq", path);
    });
  });
});
