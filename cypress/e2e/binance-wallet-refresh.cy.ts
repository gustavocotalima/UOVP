describe("atualização do card Binance", () => {
  beforeEach(() => {
    cy.viewport(1440, 1000);
    cy.registerAndLogin();
    cy.visit("/configuracoes");
    cy.waitForHydration();
  });

  it("recebe props atualizadas sem perder rascunhos de credenciais", () => {
    cy.get("#binance-api-key").type("rascunho-chave-local", { log: false });
    cy.get("#binance-api-secret").type("rascunho-segredo-local", { log: false });
    // Saving the independent timezone invalidates the layout and delivers fresh
    // server props to the existing card, without remounting its credential form.
    cy.get("#settings-time-zone").select("America/Manaus");
    cy.contains("Fuso horário atualizado.").should("exist");
    cy.get("#binance-api-key").should("have.value", "rascunho-chave-local");
    cy.get("#binance-api-secret").should("have.value", "rascunho-segredo-local");

    cy.get<string>("@testUserEmail").then((email) => cy.task("setBinanceWalletFixture", { email, quantity: "2" }));
    cy.get("#settings-time-zone").select("America/Rio_Branco");
    cy.get('[data-testid="binance-wallet-card"]').should("contain.text", "Escolha os ativos");
    cy.get('[data-binance-symbol="BTC"]').should("contain.text", "Bitcoin");
    cy.get("#binance-api-key").should("not.exist");
    cy.get('[data-testid="binance-wallet-card"]').contains("button", "Desconectar").click();
    cy.contains('[role="dialog"] button', "Remover posições importadas").click();
    cy.get("#binance-api-key").should("have.value", "rascunho-chave-local");
    cy.get("#binance-api-secret").should("have.value", "rascunho-segredo-local");
  });

  it("atualiza quantidades e preserva o diálogo de desconexão durante refresh", () => {
    cy.get<string>("@testUserEmail").then((email) => cy.task("setBinanceWalletFixture", { email, quantity: "2" }));
    cy.get("#settings-time-zone").select("America/Manaus");
    cy.contains("Fuso horário atualizado.").should("be.visible");
    cy.get("#settings-time-zone").should("be.enabled");
    cy.get('[data-binance-symbol="BTC"]', { timeout: 15_000 }).should("contain.text", "Spot 2");
    cy.get('[data-testid="binance-wallet-card"]').contains("button", "Desconectar").click();
    cy.contains('[role="dialog"]', "Desconectar a Binance").should("be.visible");

    cy.get<string>("@testUserEmail").then((email) => cy.task("setBinanceWalletFixture", { email, quantity: "3" }));
    // Dispatch an independent settings refresh behind the modal to exercise the
    // same RSC update that a completed background sync delivers.
    cy.get("#settings-time-zone").select("America/Rio_Branco", { force: true });
    cy.contains("Fuso horário atualizado.").should("be.visible");
    cy.get("#settings-time-zone").should("be.enabled");
    cy.get('[data-binance-symbol="BTC"]', { timeout: 15_000 }).should("contain.text", "Spot 3");
    cy.contains('[role="dialog"]', "Desconectar a Binance").should("be.visible");
    cy.contains('[role="dialog"] button', "Remover posições importadas").click();
    cy.get('[role="dialog"]').should("not.exist");
    cy.get("#binance-api-key").should("be.visible");
    cy.get('[data-binance-symbol="BTC"]').should("not.exist");
  });
});
