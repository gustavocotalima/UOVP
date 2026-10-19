const privacyCookie = "uovp-hide-values";
const hiddenFilter = "blur(8px)";

function togglePrivacy() {
  cy.get('button[aria-label="Ocultar valores"]:visible, button[aria-label="Mostrar valores"]:visible').click();
}

function expectHidden(hidden = true) {
  cy.get("html").should("have.attr", "data-private-values", String(hidden));
  cy.get(`button[aria-label="${hidden ? "Mostrar" : "Ocultar"} valores"]:visible`)
    .should("have.attr", "aria-pressed", String(hidden));
}

function expectNoOverflow() {
  cy.document().should((document) => {
    expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth + 1);
  });
}

describe("privacidade dos valores", () => {
  beforeEach(() => {
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedDailyExpenses", { email }));
    cy.visit("/home?year=2026&month=9");
    cy.waitForHydration();
  });

  it("desfoca sem alterar os valores e mantém a preferência no HTML inicial, navegação e login", () => {
    const total = '[data-testid="daily-expenses-total"] .private-value';
    cy.get(total).should("contain.text", "1.220,00").and("have.css", "filter", "none");
    cy.get('button[aria-label="Ocultar valores"]:visible').next('button[aria-label="Alternar tema"]').should("exist");
    togglePrivacy();
    expectHidden();
    cy.get(total).should("contain.text", "1.220,00").and("have.css", "filter", hiddenFilter)
      .and("have.css", "user-select", "none");
    cy.getCookie(privacyCookie).its("value").should("eq", "true");
    cy.get('button[data-date="2026-09-08"]').should("not.have.attr", "title").click();
    cy.get('[role="dialog"]').should("not.have.attr", "data-private-editor").within(() => {
      cy.contains("Despesa do dia").should("have.css", "filter", "none");
      cy.get(".private-value").first().should("have.css", "filter", hiddenFilter);
      cy.get('button[aria-label="Fechar"]').click();
    });
    cy.request("/home?year=2026&month=9").its("body").should("include", 'data-private-values="true"');
    cy.reload();
    cy.waitForHydration();
    expectHidden();
    cy.get(total).should("have.css", "filter", hiddenFilter);
    cy.get('nav[aria-label="Navegação principal"]').contains("a", "Contas").click();
    cy.get("main .private-value").first().should("have.css", "filter", hiddenFilter);
    cy.contains("button:visible", "Sair").click();
    cy.location("pathname").should("eq", "/login");
    cy.get<string>("@testUserEmail").then((email) => cy.get("#email").type(email));
    cy.get("#password").type("teste-seguro-123", { log: false });
    cy.contains("button", "Entrar").click();
    cy.location("pathname").should("eq", "/home");
    expectHidden();
    togglePrivacy();
    expectHidden(false);
    cy.get("main .private-value").first().should("have.css", "filter", "none");
  });

  it("mantém os controles acessíveis em celular, tablet e desktop nos dois temas", () => {
    for (const width of [360, 768, 1366]) {
      cy.viewport(width, 900);
      if (width < 1024) {
        cy.contains("button", "Mais").click();
        cy.get('#mobile-navigation button[aria-label="Alternar tema"]')
          .next('button[aria-label="Ocultar valores"]').should("be.visible");
      }
      togglePrivacy();
      expectHidden();
      for (let i = 0; i < 2; i += 1) {
        cy.get('button[aria-label="Alternar tema"]:visible').click();
        expectHidden();
        cy.get('[data-testid="daily-expenses-total"] .private-value').should("have.css", "filter", hiddenFilter);
      }
      cy.get('button[aria-label="Mostrar valores"]:visible').focus().should("have.focus");
      expectNoOverflow();
      togglePrivacy();
      expectHidden(false);
      if (width < 1024) cy.get('button[aria-label="Fechar menu"]').click();
    }
  });

  it("mantém os campos financeiros editáveis sem trocar tipos ou remover a privacidade global", () => {
    togglePrivacy();
    cy.visit("/contas");
    cy.waitForHydration();
    cy.get('button[aria-label="Editar conta"]:visible').first().click();
    cy.get('[role="dialog"]').should("have.attr", "data-private-editor", "true").within(() => {
      cy.contains("label", "Saldo atual").find("input")
        .should("have.attr", "type", "number").and("have.attr", "step", "0.01")
        .and("have.value", "1220.78").and("have.css", "filter", "none")
        .clear().type("1300.42");
      cy.contains("button", "Salvar alterações").click();
    });
    cy.get('[role="dialog"]').should("not.exist");
    expectHidden();
    cy.contains("main .private-value", "1.300,42").should("have.css", "filter", hiddenFilter);
    cy.getCookie(privacyCookie).its("value").should("eq", "true");
  });

  it("desfoca quantidades de provedores e mantém as comparações legíveis no editor portaled", () => {
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedPluggyQuantityOverride", { email }));
    togglePrivacy();
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "Mostrar vendidos").click();
    cy.contains("button", "ITUB3").click();
    cy.contains("dt", "Quantidade").next("dd").find(".private-value").should("have.css", "filter", hiddenFilter);
    cy.contains("button", "Editar informações").click();
    cy.get('[role="dialog"]').should("have.attr", "data-private-editor", "true").within(() => {
      cy.get("#metadata-quantity").should("have.attr", "type", "number").and("have.css", "filter", "none");
      cy.get(".private-value").first().should("have.css", "filter", "none");
      cy.get('button[aria-label="Fechar"]').click();
    });
    expectHidden();
    cy.contains("dt", "Quantidade").next("dd").find(".private-value").should("have.css", "filter", hiddenFilter);
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBinanceWallet", { email }));
    cy.visit("/configuracoes");
    cy.waitForHydration();
    cy.contains("p", "BTC").parent().parent().find(".private-value").first().should("have.css", "filter", hiddenFilter);
    cy.contains("••••ABCD").should("be.visible");
  });

  it("desfoca eixos e tooltips monetários, preservando os gráficos, percentuais e resultados", () => {
    togglePrivacy();
    cy.get(".private-chart-axis .recharts-cartesian-axis-tick-value").first().should("have.css", "filter", hiddenFilter);
    cy.get('[data-testid="expense-tags"] .recharts-sector').first().trigger("mouseover", { force: true });
    cy.get('[data-testid="expense-tags"] .private-chart-tooltip .recharts-tooltip-item-value')
      .first().should("be.visible").and("have.css", "filter", hiddenFilter);
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("#portfolio-tab-targets").click();
    cy.get('#portfolio-panel-targets [role="img"]').should("have.css", "filter", "none")
      .and("not.have.descendants", ".private-value");
    cy.visit("/ferramentas");
    cy.waitForHydration();
    cy.get("#annual-rate").clear().type("8");
    cy.get("#initial-value").clear().type("10000");
    cy.get("#desired-value").clear().type("1000000");
    cy.contains("button", "Calcular").click();
    cy.contains("tr", "R$ 50,00").should(($row) => {
      expect($row.text().replace(/\u00a0/g, " ")).to.contain("R$ 30.595,46");
    }).find(".private-value").first().should("have.css", "filter", hiddenFilter);
    cy.get(".recharts-line-curve").first().should("have.css", "filter", "none");
    cy.get(".private-chart-axis .recharts-cartesian-axis-tick-value").first().should("have.css", "filter", hiddenFilter);
    cy.get(".recharts-wrapper").then(($chart) => {
      const rect = $chart[0].getBoundingClientRect();
      cy.wrap($chart).trigger("mousemove", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    });
    cy.get(".private-chart-tooltip-names .recharts-tooltip-item-name").first().should("have.css", "filter", hiddenFilter);
  });

  it("exporta exatamente os mesmos dados da carteira com e sem privacidade", () => {
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedBinanceWallet", { email }));
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("[data-assets-panel-hydrated='true']");
    const exports: Blob[] = [];
    cy.window().then((appWindow) => {
      cy.stub(appWindow.URL, "createObjectURL").callsFake((blob: Blob) => {
        exports.push(blob);
        return "blob:uovp-privacy-export";
      });
      cy.stub(appWindow.URL, "revokeObjectURL");
      cy.stub(appWindow.HTMLAnchorElement.prototype, "click");
    });
    cy.contains("button:visible", "Exportar XLSX").click();
    togglePrivacy();
    cy.contains("tbody tr", "ADA").find(".private-value").first().should("have.css", "filter", hiddenFilter);
    cy.contains("button:visible", "Exportar XLSX").should("be.enabled").click();
    cy.then(() => {
      expect(exports).to.have.length(2);
      return Promise.all(exports.map((blob) => blob.arrayBuffer()));
    }).then(([visible, hidden]) => {
      expect(Array.from(new Uint8Array(hidden))).to.deep.equal(Array.from(new Uint8Array(visible)));
    });
  });
});
