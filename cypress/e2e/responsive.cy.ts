const appRoutes = [
  "/home",
  "/orcamento-domestico",
  "/metas",
  "/contas",
  "/faturas",
  "/transacoes",
  "/tags",
  "/carteira",
  "/ferramentas",
  "/open-finance",
  "/perfil",
  "/configuracoes",
];

function expectNoPageOverflow() {
  cy.document().should((document) => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({ element, rectangle: element.getBoundingClientRect() }))
      .filter(({ rectangle }) => rectangle.width > 0 && (rectangle.right > viewportWidth + 1 || rectangle.left < -1))
      .slice(-8)
      .map(({ element, rectangle }) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${element.className.toString().split(/\s+/).slice(0, 2).join(".")} (${Math.round(rectangle.left)}–${Math.round(rectangle.right)})`);
    expect(
      document.documentElement.scrollWidth,
      `largura total do documento; elementos: ${offenders.join(", ") || "nenhum"}`,
    ).to.be.at.most(viewportWidth + 1);
  });
}

describe("layout responsivo", () => {
  beforeEach(() => {
    cy.viewport(390, 844);
    cy.registerAndLogin();
  });

  it("usa navegação inferior e abre as opções secundárias", () => {
    cy.get('nav[aria-label="Navegação móvel"]').should("be.visible");
    cy.get('nav[aria-label="Navegação móvel"]').contains("a", "Carteira").click();
    cy.location("pathname").should("eq", "/carteira");

    cy.contains("button", "Mais").click();
    cy.get('[role="dialog"][aria-label="Mais opções"]').should("be.visible");
    cy.get("#mobile-navigation").contains("a", "Contas").click();
    cy.location("pathname").should("eq", "/contas");
    cy.get('[role="dialog"][aria-label="Mais opções"]').should("not.exist");
  });

  it("não cria overflow horizontal nas rotas principais em celular e tablet", () => {
    for (const [width, height] of [[360, 800], [390, 844], [768, 1024]] as const) {
      cy.viewport(width, height);
      for (const route of appRoutes) {
        cy.visit(route);
        cy.waitForHydration();
        expectNoPageOverflow();
      }
    }
  });

  it("adapta sidebar e conteúdo entre notebook, Full HD e Quad HD", () => {
    for (const [width, height] of [[1366, 768], [1536, 864], [1920, 1080]] as const) {
      cy.viewport(width, height);
      cy.visit("/home");
      cy.waitForHydration();
      cy.get('nav[aria-label="Navegação móvel"]').should("not.be.visible");
      cy.get('nav[aria-label="Navegação principal"]').parent("aside").should("have.css", "width", "224px");
      expectNoPageOverflow();
    }

    cy.viewport(2560, 1440);
    cy.visit("/home");
    cy.waitForHydration();
    cy.get('nav[aria-label="Navegação principal"]').parent("aside").should("have.css", "width", "256px");
    expectNoPageOverflow();
  });

  it("exibe transações como cards expansíveis e mantém todas as ações", () => {
    cy.get("@testUserEmail").then((email) => {
      cy.task("seedFinanceClassification", { email });
    });
    cy.visit("/transacoes");
    cy.waitForHydration();

    cy.contains('[data-testid="mobile-transaction-card"]', "Mercado classificado")
      .should("be.visible")
      .find('button[aria-expanded="false"]')
      .click();
    cy.contains('[data-testid="mobile-transaction-card"]', "Mercado classificado")
      .should("contain", "Meta")
      .and("contain", "Tags")
      .and("contain", "Ocultar dos relatórios");
    expectNoPageOverflow();
  });

  it("usa cards na carteira e modal de formulário em tela cheia", () => {
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("[data-assets-panel-hydrated='true']", { timeout: 15_000 });

    cy.contains("summary", "Mais").click();
    cy.get("details[open]").contains("button", "Renda fixa").click();
    cy.get("#fixed-family").select("BANK_DEPOSITS_FGC");
    cy.get("#fixed-indexation").select("PRE_FIXED");
    cy.get("#fixed-score").type("{selectall}7");
    cy.get('button[form="fixed-income-group-form"]').click();

    cy.get('[data-testid="mobile-asset-card"]').should("be.visible");
    cy.contains('[data-testid="mobile-asset-card"]', "CDB/RDB/LC-PRE").should("contain", "Valor atual");

    cy.contains("button:visible", "Adicionar ativo").click();
    cy.window().then((appWindow) => {
      cy.get('[role="dialog"]').should(($dialog) => {
        const rectangle = $dialog[0].getBoundingClientRect();
        expect(rectangle.top).to.be.closeTo(0, 1);
        expect(rectangle.height).to.be.closeTo(appWindow.innerHeight, 1);
      });
    });
    expectNoPageOverflow();
  });
});
