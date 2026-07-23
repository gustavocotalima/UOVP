describe("layout responsivo", () => {
  it("navega pelo menu móvel", () => {
    cy.viewport(390, 844);
    cy.registerAndLogin();
    cy.get('button[aria-label="Abrir menu"]').click();
    cy.get("div.fixed.inset-0.z-50").contains("a", "Carteira").click();
    cy.location("pathname").should("eq", "/carteira");
  });
});
