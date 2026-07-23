export {};

// Cypress augments its global chainable API through a namespace declaration.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Cypress {
    interface Chainable {
      registerAndLogin(): Chainable<void>;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

Cypress.Commands.add("registerAndLogin", () => {
  const email = `cypress-${Date.now()}-${Cypress._.random(1000, 9999)}@example.com`;
  cy.visit("/register");
  cy.get("#name").type("Usuário Cypress");
  cy.get("#email").type(email);
  cy.get("#password").type("teste-seguro-123");
  cy.contains("button", "Criar conta").click();
  cy.location("pathname").should("eq", "/login");
  cy.get("#email").type(email);
  cy.get("#password").type("teste-seguro-123");
  cy.contains("button", "Entrar").click();
  cy.url().should("include", "/home");
});
