describe("ferramentas", () => {
  beforeEach(() => cy.registerAndLogin());

  it("reproduz o cálculo verificado do primeiro milhão", () => {
    cy.visit("/ferramentas");
    cy.get("#annual-rate").type("{selectall}8");
    cy.get("#initial-value").type("{selectall}10000");
    cy.get("#desired-value").type("{selectall}1000000");
    cy.contains("button", "Calcular").click();
    cy.contains("tr", "R$ 50,00").should(($row) => {
      expect($row.text().replace(/\u00a0/g, " ")).to.contain("R$ 30.595,46");
    });
  });

  it("mantém a FAQ acessível por categoria", () => {
    cy.visit("/faq?categoria=ferramentas");
    cy.contains("button", "Ferramentas").should("have.attr", "aria-expanded", "true");
    cy.contains("button", "Para que serve a ferramenta de primeiro milhão?").click();
    cy.contains("Ela projeta o valor futuro").should("be.visible");
  });
});
