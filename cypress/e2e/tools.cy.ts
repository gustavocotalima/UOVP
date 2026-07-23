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
});
