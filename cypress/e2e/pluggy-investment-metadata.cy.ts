describe("metadados editáveis de investimentos Pluggy", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => {
      cy.task("seedPluggyEditableInvestment", { email });
    });
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
  });

  it("edita, compara, restaura por campo e persiste após reload", () => {
    cy.contains("button", "CDB ORIGINAL CYPRESS").click();
    cy.contains("button", "Editar informações").click();

    cy.get('[role="dialog"]').contains("Editar informações do investimento").should("be.visible");
    cy.get("#metadata-product-name").should("be.disabled").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
    });
    cy.get("#metadata-product-name").should("be.enabled").clear().type("CDB corrigido Cypress");

    cy.get("#metadata-issuer").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
    });
    cy.get("#metadata-issuer").clear().type("Banco Cypress S.A.");

    cy.get("#metadata-product-type").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
      cy.get("#metadata-product-type").select("");
      cy.get('input[placeholder="Tipo personalizado"]').type("CDB corrigido sem garantia presumida");
    });

    cy.contains('[role="dialog"] label', "Rentabilidade contratada").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
      cy.get('select[aria-label="Formato da taxa"]').select("FIXED_ANNUAL");
      cy.get('input[aria-label="Taxa"]').clear().type("14.85");
    });

    cy.get("#metadata-purchase-date").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
    });
    cy.get("#metadata-purchase-date").type("2026-06-16");
    cy.get("#metadata-maturity-date").parent().within(() => {
      cy.get('input[type="checkbox"]').check();
    });
    cy.get("#metadata-maturity-date").type("2027-08-25");

    cy.contains("button", "Salvar informações").click();
    cy.contains("button", "CDB corrigido Cypress", { timeout: 15_000 })
      .should("contain.text", "Editado manualmente");
    cy.contains("dt", "Emissor").next("dd").should("have.text", "Banco Cypress S.A.");
    cy.contains("dt", "Rentabilidade").next("dd").should("contain.text", "14,85% a.a.");
    cy.contains("summary", "Dados originais da instituição").click();
    cy.contains("dt", "Produto").next("dd").should("have.text", "CDB ORIGINAL CYPRESS");
    cy.contains("dt", "rate").next("dd").should("have.text", "0");
    cy.contains("dt", "fixedAnnualRate").next("dd").should("have.text", "8.95");

    cy.reload();
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "CDB corrigido Cypress").click();
    cy.contains("button", "Editar informações").click();
    cy.get("#metadata-product-name").parent().within(() => {
      cy.get('input[type="checkbox"]').should("be.checked").uncheck();
      cy.contains("restaurar o valor da instituição").should("not.exist");
    });
    cy.contains("button", "Salvar informações").click();

    cy.contains("button", "CDB ORIGINAL CYPRESS", { timeout: 15_000 })
      .should("contain.text", "Editado manualmente");
    cy.contains("dt", "Emissor").next("dd").should("have.text", "Banco Cypress S.A.");

    cy.contains("button", "Editar informações").click();
    cy.contains("button", "Restaurar tudo").click();
    cy.get('[role="dialog"]').last().within(() => {
      cy.contains("Restaurar informações da instituição?").should("be.visible");
      cy.contains("button", "Restaurar tudo").click();
    });
    cy.contains("button", "CDB ORIGINAL CYPRESS", { timeout: 15_000 })
      .should("not.contain.text", "Editado manualmente");
    cy.contains("dt", "Emissor").next("dd").should("have.text", "BANCO ORIGINAL CYPRESS S.A.");
    cy.contains("dt", "Rentabilidade").next("dd").should("have.text", "N/A");
  });
});
