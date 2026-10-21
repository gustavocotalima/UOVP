describe("invalidação dos dados Open Finance", () => {
  let activeSync = false;
  let snapshotLabel = "Anterior";

  beforeEach(() => {
    activeSync = false;
    snapshotLabel = "Anterior";
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedPluggyQuantityOverride", { email }));
    cy.intercept("GET", "/api/pluggy/sync-status", (request) => {
      request.reply({ active: activeSync, automatic: true });
    });
  });

  function completeExternalSync() {
    // Visibility recovery also checks status immediately when no local action is running.
    cy.then(() => { activeSync = true; });
    cy.document().then((document) => document.dispatchEvent(new Event("visibilitychange")));
    cy.contains('[role="status"]', "Sincronizando Open Finance automaticamente").should("exist");
    cy.then(() => {
      snapshotLabel = "Atualizado";
      activeSync = false;
    });
    cy.document().then((document) => document.dispatchEvent(new Event("visibilitychange")));
    cy.contains('[role="status"]', "Sincronizando Open Finance automaticamente").should("not.exist");
  }

  function transactionPageBody(page: number, label: string) {
    return {
      page,
      total: 26,
      transactions: [{
        id: `transaction-${page}`,
        institution: "Inter",
        accountName: "Conta corrente",
        description: `${label} página ${page}`,
        merchantName: null,
        category: null,
        amount: "25",
        currencyCode: "BRL",
        date: "2026-07-01T12:00:00.000Z",
        type: "CREDIT",
        status: "POSTED",
      }],
    };
  }

  it("mostra erro local na página 2 sem reutilizar as linhas da página 1 e permite retentar", () => {
    let failPageTwo = true;
    let releaseRetry: (() => void) | undefined;
    cy.intercept("GET", "/api/open-finance/transactions?*", (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      if (page === 2 && failPageTwo) {
        request.reply({ statusCode: 503, body: { error: "Serviço temporariamente indisponível." } });
        return;
      }
      if (page === 2) {
        return new Promise<void>((resolve) => {
          releaseRetry = () => {
            request.reply(transactionPageBody(page, "Retentativa"));
            resolve();
          };
        });
      }
      request.reply(transactionPageBody(page, "Anterior"));
    }).as("transactions");
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Transações").click();
    cy.wait("@transactions");
    cy.contains("Anterior página 1").should("exist");
    cy.contains("button", "Próxima").click();
    cy.wait("@transactions").its("response.statusCode").should("equal", 503);
    cy.get("#open-finance-panel-transactions").within(() => {
      cy.contains("Página 2 de 2").should("exist");
      cy.contains('[role="alert"]', "Não foi possível carregar a página 2").should("exist");
      cy.contains("Anterior página 1").should("not.exist");
      cy.contains("Nenhuma transação sincronizada.").should("not.exist");
      cy.contains("button", "Anterior").should("be.enabled");
      cy.contains("button", "Próxima").should("be.disabled");
      cy.then(() => { failPageTwo = false; });
      cy.contains("button", "Tentar novamente").click();
      cy.contains("Carregando transações…").should("exist");
      cy.contains("button", "Anterior").should("be.disabled");
      cy.contains("button", "Próxima").should("be.disabled");
      cy.get('[role="alert"]').should("not.exist");
    });
    cy.wrap(null).should(() => { expect(releaseRetry).to.be.a("function"); });
    cy.then(() => releaseRetry!());
    cy.wait("@transactions");
    cy.get("#open-finance-panel-transactions").within(() => {
      cy.contains("Retentativa página 2").should("exist");
      cy.contains("Página 2 de 2").should("exist");
      cy.contains("Anterior página 1").should("not.exist");
      cy.contains("Carregando transações…").should("not.exist");
      cy.get('[role="alert"]').should("not.exist");
    });
  });

  it("ignora respostas atrasadas após sair da aba e atualizar o snapshot na mesma página", () => {
    const releases: Array<() => void> = [];
    let returnedObsolete = 0;
    let pageTwoRequests = 0;
    cy.intercept("GET", "/api/open-finance/transactions?*", (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      request.reply(transactionPageBody(page, snapshotLabel));
    }).as("transactions");
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.window().then((window) => {
      const fetch = window.fetch.bind(window);
      // Hold delivery after real HTTP completes, so releasing a stale response is
      // deterministic even when the component has already aborted its signal.
      cy.stub(window, "fetch").callsFake(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fetch(input, init);
        if (String(input).includes("/api/open-finance/transactions?page=2") && ++pageTwoRequests <= 2) {
          await new Promise<void>((resolve) => { releases.push(resolve); });
          returnedObsolete += 1;
        }
        return response;
      });
    });
    cy.contains("button", "Transações").click();
    cy.wait("@transactions");
    cy.contains("button", "Próxima").click();
    cy.wait("@transactions");
    cy.wrap(null).should(() => { expect(releases).to.have.length(1); });
    cy.contains("button", "Contas").click();
    cy.contains("button", "Transações").click();
    cy.wait("@transactions");
    cy.wrap(null).should(() => { expect(releases).to.have.length(2); });
    completeExternalSync();
    cy.wait("@transactions").its("request.url").should("include", "page=2");
    cy.contains("Atualizado página 2").should("exist");
    cy.then(() => { releases.forEach((release) => release()); });
    cy.wrap(null).should(() => { expect(returnedObsolete).to.equal(2); });
    cy.get("#open-finance-panel-transactions").within(() => {
      cy.contains("Atualizado página 2").should("exist");
      cy.contains("Página 2 de 2").should("exist");
      cy.contains("Anterior página 1").should("not.exist");
      cy.contains("Anterior página 2").should("not.exist");
      cy.contains("Carregando transações…").should("not.exist");
      cy.get('[role="alert"]').should("not.exist");
    });
  });

  it("atualiza a consulta ativa após refresh externo preservando aba e página", () => {
    cy.intercept("GET", "/api/open-finance/transactions?*", (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      request.reply({
        page,
        total: 26,
        transactions: [{
          id: `transaction-${page}`,
          institution: "Inter",
          accountName: "Conta corrente",
          description: `${snapshotLabel} página ${page}`,
          merchantName: null,
          category: null,
          amount: "25",
          currencyCode: "BRL",
          date: "2026-07-01T12:00:00.000Z",
          type: "CREDIT",
          status: "POSTED",
        }],
      });
    }).as("transactions");
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Transações").click();
    cy.wait("@transactions");
    cy.contains("Anterior página 1").should("exist");
    cy.contains("button", "Próxima").click();
    cy.wait("@transactions");
    cy.contains("Anterior página 2").should("exist");
    completeExternalSync();
    cy.wait("@transactions").its("request.url").should("include", "page=2");
    cy.get("#open-finance-tab-transactions").should("have.attr", "aria-selected", "true");
    cy.contains("Atualizado página 2").should("exist");
    cy.contains("Página 2 de 2").should("exist");
  });

  it("recarrega o investimento expandido sem perder o rascunho do editor", () => {
    cy.intercept("GET", "/api/open-finance/investments/*/transactions?*", (request) => {
      request.reply({
        page: 1,
        total: 1,
        transactions: [{
          id: "movement-a",
          description: `${snapshotLabel} movimento`,
          type: "BUY",
          movementType: "CREDIT",
          quantity: "110",
          value: "40",
          amount: "4400",
          netAmount: null,
          agreedRate: null,
          brokerageNumber: null,
          date: "2026-07-01T12:00:00.000Z",
          tradeDate: null,
          expenses: null,
        }],
      });
    }).as("movements");
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Investimentos").click();
    cy.contains("button", "Mostrar vendidos").click();
    cy.contains("button", "ITUB3").click();
    cy.wait("@movements");
    cy.contains("Anterior movimento").should("exist");
    cy.contains("button", "Editar informações").click();
    cy.get("#metadata-quantity").parent().find('input[type="checkbox"]').check();
    cy.get("#metadata-quantity").clear().type("137");
    completeExternalSync();
    cy.wait("@movements").its("request.url").should("include", "page=1");
    cy.get("#metadata-quantity").should("have.value", "137");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();
    cy.get("#open-finance-tab-investments").should("have.attr", "aria-selected", "true");
    cy.contains("button", "ITUB3").should("have.attr", "aria-expanded", "true");
    cy.contains("Atualizado movimento").should("exist");
    cy.contains("Anterior movimento").should("not.exist");
  });

  it("volta à primeira página sem estado vazio intermediário quando o total cai de 26 para 25", () => {
    cy.intercept("GET", "/api/open-finance/transactions?*", (request) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      const total = snapshotLabel === "Anterior" ? 26 : 25;
      const start = (page - 1) * 25;
      const count = Math.max(0, Math.min(25, total - start));
      request.reply({
        delay: snapshotLabel === "Atualizado" && page === 1 ? 500 : 0,
        body: {
          page,
          total,
          transactions: Array.from({ length: count }, (_, index) => ({
            id: `transaction-${start + index + 1}`,
            institution: "Inter",
            accountName: "Conta corrente",
            description: `${snapshotLabel} item ${start + index + 1}`,
            merchantName: null,
            category: null,
            amount: "25",
            currencyCode: "BRL",
            date: "2026-07-01T12:00:00.000Z",
            type: "CREDIT",
            status: "POSTED",
          })),
        },
      });
    }).as("transactions");
    cy.visit("/open-finance");
    cy.waitForHydration();
    cy.contains("button", "Transações").click();
    cy.wait("@transactions");
    cy.contains("button", "Próxima").click();
    cy.wait("@transactions");
    cy.contains("Anterior item 26").should("exist");
    completeExternalSync();
    cy.wait("@transactions").its("request.url").should("include", "page=2");
    cy.contains("Carregando transações…").should("exist");
    cy.contains("Nenhuma transação sincronizada.").should("not.exist");
    cy.wait("@transactions").its("request.url").should("include", "page=1");
    cy.get("#open-finance-tab-transactions").should("have.attr", "aria-selected", "true");
    cy.contains("Atualizado item 1").should("exist");
    cy.contains("Atualizado item 25").should("exist");
    cy.contains("25 lançamento(s)").should("exist");
    cy.contains("Carregando transações…").should("not.exist");
    cy.contains("Anterior item 26").should("not.exist");
    cy.contains("button", "Próxima").should("not.exist");
  });
});
