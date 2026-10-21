import type { FinanceTransactionPageDto } from "../../features/finance/types";

describe("invalidação e paginação das transações", () => {
  beforeEach(() => {
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedDailyExpenses", { email }));
  });

  it("usa o snapshot inicial sem GET duplicado e atualiza a consulta filtrada após uma ação", () => {
    let initialRequests = 0;
    let completeSearchRequests = 0;
    cy.intercept("GET", "/api/finance/transactions?*", (request) => {
      const search = new URL(request.url).searchParams.get("search");
      if (!search) initialRequests += 1;
      if (search === "Despesa do dia") {
        completeSearchRequests += 1;
        request.alias = completeSearchRequests === 1 ? "initialFiltered"
          : completeSearchRequests === 2 ? "refreshedFiltered" : "secondRefreshedFiltered";
      }
    });
    cy.visit("/transacoes?year=2026&month=9");
    cy.waitForHydration();
    cy.contains("tr", "Despesa do dia").should("be.visible");
    cy.then(() => expect(initialRequests).to.equal(0));

    cy.get('input[aria-label="Pesquisar transação"]').type("Despesa do dia");
    cy.wait("@initialFiltered");
    cy.contains("tr", "Despesa do dia").find("select").first().select("GOALS");
    cy.contains("Meta atualizada.").should("be.visible");
    // The server action refreshes the snapshot; the active query must fetch again.
    cy.wait("@refreshedFiltered").its("request.url").should("include", "search=Despesa+do+dia");
    cy.get('input[aria-label="Pesquisar transação"]').should("have.value", "Despesa do dia");
    cy.contains("tr", "Despesa do dia").find("select").first().should("have.value", "GOALS");

    cy.contains("button", "Mais filtros").click();
    cy.get('[aria-label="Valor mínimo"]').type("10");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();
    cy.contains("tr", "Despesa do dia").find("select").first().select("COMFORT");
    cy.contains("Meta atualizada.").should("be.visible");
    cy.wait("@secondRefreshedFiltered");
    // Refreshing financial rows does not remount the component or reset the search.
    cy.get('input[aria-label="Pesquisar transação"]').should("have.value", "Despesa do dia");
    cy.contains("tr", "Despesa do dia").find("select").first().should("have.value", "COMFORT");
  });

  it("consulta a página 1 após excluir o único registro da página 2", () => {
    cy.request<FinanceTransactionPageDto>("/api/finance/transactions?year=2026&month=9&mode=MONTH&internal=no")
      .then(({ body }) => {
        const realTransaction = body.transactions.find((transaction) => transaction.description === "Despesa do dia")!;
        const pageOne = Array.from({ length: 25 }, (_, index) => ({
          ...realTransaction, id: `pagination-${index}`, description: `Registro de paginação ${index + 1}`,
        }));
        let removed = false;
        let releasePageOne: (() => void) | undefined;
        const requests: number[] = [];
        cy.intercept("GET", "/api/finance/transactions?*", (request) => {
          const params = new URL(request.url).searchParams;
          if (params.get("search") !== "paginação") return;
          const page = Number(params.get("page"));
          requests.push(page);
          request.alias = "page";
          const reply = () => request.reply({
            body: {
              ...body, page, pageSize: 25, total: removed ? 25 : 26,
              transactions: page === 1 ? pageOne : removed ? [] : [realTransaction],
            },
          });
          if (removed && page === 1) {
            // Hold the response until the loading-state assertion observes it.
            return new Promise<void>((resolve) => {
              releasePageOne = () => { reply(); resolve(); };
            });
          }
          reply();
        });
        cy.visit("/transacoes?year=2026&month=9");
        cy.waitForHydration();
        cy.get('input[aria-label="Pesquisar transação"]').type("paginação");
        cy.wait("@page");
        cy.contains("Página 1 de 2").should("be.visible");
        cy.get('button[aria-label="Próxima página"]').click();
        cy.wait("@page");
        cy.contains("tr", "Despesa do dia").find('button[aria-haspopup="menu"]').click();
        cy.contains('button[role="menuitem"]', "Deletar").click();
        cy.then(() => { removed = true; });
        cy.get('[role="dialog"]').contains("button", "Deletar").click();
        cy.contains("Transação removida.").should("be.visible");
        cy.get('[data-testid="transaction-results"]:visible').should("have.attr", "aria-busy", "true");
        cy.wrap(null).should(() => { expect(releasePageOne).to.be.a("function"); })
          .then(() => releasePageOne!());
        cy.contains("Página 1 de 1").should("be.visible");
        cy.get("table tbody tr").should("have.length", 25);
        cy.get('[data-testid="transaction-results"]:visible').should("have.attr", "aria-busy", "false");
        cy.get('button[aria-label="Página anterior"]').should("be.disabled");
        cy.get('button[aria-label="Próxima página"]').should("be.disabled");
        cy.contains("Nenhuma transação encontrada.").should("not.exist");
        cy.then(() => expect(requests.slice(-2)).to.deep.equal([2, 1]));
      });
  });
});
