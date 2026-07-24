export {};

// Cypress augments its global chainable API through a namespace declaration.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Cypress {
    interface Chainable {
      registerAndLogin(): Chainable<void>;
      waitForHydration(): Chainable<JQuery<HTMLElement>>;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

Cypress.Commands.add("registerAndLogin", () => {
  const email = `cypress-${Date.now()}-${Cypress._.random(1000, 9999)}@example.com`;
  cy.wrap(email, { log: false }).as("testUserEmail");
  cy.task<string>("createRegistrationInvite", { email }).then((token) => {
    cy.visit(`/register?token=${encodeURIComponent(token)}`);
    cy.waitForHydration();
    cy.get("#name").type("Usuário Cypress");
    cy.get("#email").should("have.value", email).and("have.attr", "readonly");
    cy.get("#password").type("teste-seguro-123");
    cy.contains("button", "Criar conta").click();
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/login");
  });
  cy.request("/api/auth/csrf").then(({ body }) => {
    cy.request({
      method: "POST",
      url: "/api/auth/callback/credentials",
      form: true,
      followRedirect: false,
      body: {
        csrfToken: body.csrfToken,
        email,
        password: "teste-seguro-123",
        callbackUrl: "/home",
      },
    }).its("status").should("be.oneOf", [200, 302]);
  });
  cy.visit("/home");
  cy.waitForHydration();
  cy.location("pathname", { timeout: 15_000 }).should("eq", "/home");
});

Cypress.Commands.add("waitForHydration", () =>
  cy.get("html[data-app-hydrated='true']", { timeout: 15_000 }),
);
