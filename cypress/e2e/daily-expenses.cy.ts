function expectNoHorizontalOverflow() {
  cy.document().should((document) => {
    expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth + 1);
  });
}

describe("calendário de saídas do painel", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.get<string>("@testUserEmail").then((email) => cy.task("seedDailyExpenses", { email }));
    cy.visit("/home?year=2026&month=9");
    cy.waitForHydration();
  });

  it("mostra saídas brutas no calendário e conserva resumos líquidos", () => {
    cy.get('[data-testid="daily-expenses-total"]').should("contain.text", "1.220,00");
    cy.contains("p", "Despesas líquidas").parent().should("contain.text", "679,40");
    cy.get('[data-testid="daily-expenses"] button[data-date]').should("have.length", 30);
    cy.get('button[data-date="2026-09-08"]')
      .should("have.attr", "aria-label").and("contain", "1.175,75");
    cy.get('button[data-date="2026-09-08"]').focus().type("{enter}");
    cy.get('[role="dialog"]').should("be.visible").within(() => {
      cy.contains("8 de setembro de 2026").should("be.visible");
      cy.contains("Despesa do dia").should("be.visible");
      cy.contains("Reinvestimento").should("be.visible");
      cy.contains("Compensado:").should("not.exist");
      cy.contains("Original: -R$ 540,60").should("not.exist");
      cy.contains("-R$ 540,60").should("be.visible");
      cy.contains("Oculta do relatório").should("not.exist");
      cy.contains("Transferência interna").should("not.exist");
      cy.contains("Entrada disponível").should("not.exist");
      cy.get("footer").should("contain.text", "1.175,75");
      cy.get('button[aria-label="Fechar"]').focus().trigger("keydown", { key: "Tab", shiftKey: true });
      cy.focused().should("have.attr", "aria-label", "Fechar");
    });
    cy.focused().type("{esc}");
    cy.get('[role="dialog"]').should("not.exist");
    cy.focused().should("have.attr", "data-date", "2026-09-08");

    cy.get('[data-testid="expense-tags"] [role="img"]')
      .should("have.attr", "aria-label").and("contain", "R$ 1.781,06");
    cy.get('[data-testid="expense-tags"]').should("contain.text", "Saída R$ 1.220,00")
      .and("contain.text", "Entrada R$ 561,06")
      .and("not.contain.text", "compensado");

    cy.contains("button", "Ver lançamentos fora do mês").click();
    cy.get('[role="dialog"]').should("contain.text", "Parcela fora do mês")
      .and("contain.text", "15/08/2026").and("contain.text", "44,25");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();
    cy.get('button[data-date="2026-09-01"]').click();
    cy.get('[role="dialog"]').should("contain.text", "Nenhuma saída incluída")
      .find('button[aria-label="Fechar"]').click();
    cy.get('button[aria-label="Próximo mês"]').click();
    cy.get('[data-testid="daily-expenses"] button[data-date]').should("have.length", 31);
    cy.get('[data-testid="daily-expenses-total"]').should("contain.text", "0,00");
  });

  it("mantém o calendário e os detalhes utilizáveis no celular, tablet e desktop", () => {
    for (const [width, height] of [[360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768], [1920, 1080], [2560, 1440]] as const) {
      cy.viewport(width, height);
      cy.get('[data-testid="daily-expenses"]').scrollIntoView();
      expectNoHorizontalOverflow();
      cy.get('button[data-date="2026-09-08"]').should(($button) => {
        const rectangle = $button[0].getBoundingClientRect();
        expect(rectangle.height).to.be.at.least(44);
        expect($button[0].scrollWidth).to.be.at.most(rectangle.width + 1);
      }).click();
      cy.get('[role="dialog"]').should("be.visible").and("contain.text", "1.175,75");
      expectNoHorizontalOverflow();
      cy.get('[role="dialog"] button[aria-label="Fechar"]').click();
    }
  });

  it("expande o gráfico de tags no desktop sem aumentar o gráfico no celular", () => {
    for (const width of [360, 390, 430, 768]) {
      cy.viewport(width, 900);
      cy.get('[data-testid="expense-tags"] [role="img"]').should(($chart) => {
        expect($chart[0].getBoundingClientRect().height).to.equal(width < 640 ? 224 : 256);
      });
      expectNoHorizontalOverflow();
    }

    for (const width of [1920, 2560]) {
      cy.viewport(width, 1080);
      cy.get('[data-testid="expense-tags"]').should(($card) => {
        const card = $card[0];
        const chart = card.querySelector('[role="img"]')!;
        const chartBounds = chart.getBoundingClientRect();
        const svg = chart.querySelector("svg")!;
        const link = card.querySelector("a")!;
        expect(chartBounds.height).to.be.greaterThan(256);
        expect(svg.getBoundingClientRect().height).to.be.closeTo(chartBounds.height, 1);
        expect(card.getBoundingClientRect().bottom - link.getBoundingClientRect().bottom).to.be.at.most(22);
      });
      cy.get('[data-testid="expense-tags"] [role="img"]').then(($chart) => {
        const originalHeight = $chart[0].getBoundingClientRect().height;
        cy.get('[data-testid="daily-expenses"]').then(($calendar) => {
          $calendar.css("min-height", $calendar[0].getBoundingClientRect().height + 120);
        });
        cy.get('[data-testid="expense-tags"] [role="img"]').should(($expanded) => {
          expect($expanded[0].getBoundingClientRect().height).to.be.closeTo(originalHeight + 120, 1);
        });
        cy.get('[data-testid="daily-expenses"]').invoke("css", "min-height", "");
      });
      expectNoHorizontalOverflow();
    }
  });
});
