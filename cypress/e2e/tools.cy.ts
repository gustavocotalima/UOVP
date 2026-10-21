describe("ferramentas", () => {
  beforeEach(() => cy.registerAndLogin());

  it("reproduz o cálculo verificado do primeiro milhão", () => {
    cy.visit("/ferramentas");
    cy.waitForHydration();
    cy.get("#annual-rate").type("{selectall}8");
    cy.get("#initial-value").type("{selectall}10000");
    cy.get("#desired-value").type("{selectall}1000000");
    cy.contains("button", "Calcular").click();
    cy.contains("tr", "R$ 50,00").should(($row) => {
      expect($row.text().replace(/\u00a0/g, " ")).to.contain("R$ 30.595,46");
    });
  });

  it("mantém campos vazios durante edição e aceita zero ao confirmar", () => {
    cy.visit("/ferramentas");
    cy.waitForHydration();
    cy.get("#annual-rate").clear().should("have.value", "");
    cy.contains("Projeção patrimonial").should("not.exist");
    cy.contains("button", "Calcular").click();
    cy.get("#annual-rate").should("have.value", "").then(($input) => {
      expect(($input[0] as HTMLInputElement).validity.valueMissing).to.equal(true);
    });
    cy.get("#annual-rate").type("0").should("have.value", "0");
    cy.get("#initial-value").clear().should("have.value", "").type("0");
    cy.get("#desired-value").clear().should("have.value", "").type("0");
    cy.contains("button", "Calcular").click();
    cy.get("#monthly-rate").should("have.value", "0,00");
    cy.contains("tr", "R$ 50,00").should(($row) => {
      expect($row.text().replace(/\u00a0/g, " ")).to.contain("R$ 6.000,00");
    });
    cy.get("body").should("not.contain", "NaN").and("not.contain", "Infinity");
  });

  it("valida o draft também no submit e preserva privacidade dos resultados", () => {
    cy.visit("/ferramentas");
    cy.waitForHydration();
    cy.get('button[aria-label="Ocultar valores"]:visible').click();
    cy.get("#initial-value").clear().should("have.value", "").and("have.css", "filter", "none");
    cy.get("#initial-value").closest("form").trigger("submit");
    cy.get('[role="alert"]').should("contain", "números válidos");
    cy.contains("Projeção patrimonial").should("not.exist");
    cy.get("#initial-value").type("17").should("have.value", "17");
    cy.contains("button", "Calcular").click();
    cy.contains("Projeção patrimonial").should("be.visible");
    cy.contains("tr", "R$ 50,00").find(".private-value").first().should("have.css", "filter", "blur(8px)");
    cy.get("html").should("have.attr", "data-private-values", "true");
  });
});
