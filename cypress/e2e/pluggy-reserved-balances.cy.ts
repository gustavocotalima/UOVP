describe("Caixinhas importadas pela Pluggy", () => {
  beforeEach(() => {
    cy.registerAndLogin();
  });

  it("mostra a Caixinha no Open Finance e exige revisão antes da Carteira", () => {
    cy.get<string>("@testUserEmail").then((email) =>
      cy.task("seedPluggyReservedBalance", { email }),
    );

    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();

    cy.contains("button", "Reserva de emergência")
      .should("be.visible")
      .and("contain.text", "Mercado Pago")
      .and("contain.text", "Caixinha")
      .click();
    cy.contains("dt", "Origem")
      .next("dd")
      .should("have.text", "Mercado Pago · Caixinha");
    cy.contains("A instituição disponibiliza somente o saldo atual desta posição")
      .should("be.visible");

    cy.visit("/carteira");
    cy.waitForHydration();
    cy.contains("1 investimento(s) precisam de revisão").should("be.visible");
    cy.contains("Seus ativos").parent().should("contain.text", "0 ativos");
    cy.contains("button", "Revisar integração").click();

    cy.get('[role="dialog"]').within(() => {
      cy.contains("Reserva de emergência").should("be.visible");
      cy.contains("dt", "Origem do saldo").next("dd").should("have.text", "Caixinha");
      cy.contains("dt", "Indexação sugerida").next("dd").should("contain.text", "Pós-fixado");
    });
  });
});
