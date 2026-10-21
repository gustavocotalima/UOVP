describe("estado compartilhado do painel de ativos", () => {
  it("preserva filtros, expansão e rascunho ao trocar de layout com privacidade ativa", () => {
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBinanceWallet", { email }));
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("[data-assets-panel-hydrated='true']");
    cy.get('button[aria-label="Ocultar valores"]:visible').click();
    cy.get('button[aria-label^="Expandir "]:visible').click();
    cy.get('input[placeholder="Buscar nome ou ticker"]').type("ADA");
    cy.get('select[aria-label="Filtrar por classe"]').select("CRYPTO");
    cy.get('button[aria-label^="Recolher "]:visible').should("have.attr", "aria-expanded", "true");
    cy.get('button[aria-label="Editar ADA"]:visible').click();
    cy.get('[role="dialog"]').should("have.attr", "data-private-editor", "true");
    cy.get("#asset-strength").type("{selectall}17").should("have.value", "17");
    cy.get("#asset-quantity").should("be.disabled").and("have.css", "filter", "none");

    cy.viewport(360, 900);
    cy.get("#asset-strength").should("have.value", "17");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();
    cy.get('input[placeholder="Buscar nome ou ticker"]').should("have.value", "ADA");
    cy.get('select[aria-label="Filtrar por classe"]').should("have.value", "CRYPTO");
    cy.contains('[data-testid="mobile-asset-card"]', "ADA").should("be.visible").within(() => {
      cy.get('button[aria-expanded="true"]').should("be.visible");
      cy.get(".private-value").first().should("have.css", "filter", "blur(8px)");
    });
    cy.get("html").should("have.attr", "data-private-values", "true");

    cy.viewport(1440, 1000);
    cy.get('button[aria-label^="Recolher "]:visible').should("have.attr", "aria-expanded", "true");
    cy.contains("tbody tr", "ADA").find(".private-value").first().should("have.css", "filter", "blur(8px)");
  });

  it("compartilha a correção do logo entre desktop e celular sem nova server action", () => {
    const broken = "https://icons.brapi.dev/icons/uovp-cypress-invalid-EMBJ3.svg";
    let resolutions = 0;
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBrokenMarketLogo", { email }));
    cy.intercept("GET", `${broken}*`, { statusCode: 404, body: "", headers: { "cache-control": "no-store" } });
    cy.intercept("POST", "/carteira", (request) => {
      const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
      if (body.includes("failedLogoUrls") && body.includes("uovp-cypress-invalid-EMBJ3.svg")) resolutions += 1;
    });
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.contains("tbody tr", "EMBJ3").find("img[data-asset-logo]", { timeout: 15_000 }).should("be.visible")
      .and("have.attr", "src").and("not.include", "uovp-cypress-invalid").then((src) => {
        cy.viewport(360, 900);
        cy.contains('[data-testid="mobile-asset-card"]', "EMBJ3").find("img[data-asset-logo]")
          .should("be.visible").and("have.attr", "src", src);
        cy.viewport(1440, 1000);
        cy.contains("tbody tr", "EMBJ3").find("img[data-asset-logo]").should("have.attr", "src", src);
      });
    cy.then(() => expect(resolutions).to.equal(1));
  });
});
