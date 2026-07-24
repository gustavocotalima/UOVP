describe("modais da carteira", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.visit("/carteira");
    cy.waitForHydration();
    cy.get("[data-assets-panel-hydrated='true']", { timeout: 15_000 });
  });

  it("exibe o logo do Yahoo Finance na tabela da carteira", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-class").select("INTERNATIONAL_STOCKS");
    cy.get("#asset-ticker").type("AAPL");
    cy.get("#market-ticker-options", { timeout: 10000 }).contains('[role="option"]', "AAPL").click();
    cy.get("#asset-quantity").type("{selectall}1");
    cy.get('button[form="asset-modal-form"]').click();

    cy.contains("tbody tr", "AAPL")
      .find("[data-asset-logo]")
      .should("be.visible")
      .and("have.attr", "src")
      .and("include", "s.yimg.com");
  });

  it("abre o modal de adição de ativo e fecha pelo controle acessível", () => {
    cy.contains("button", "Atualizar cotações").should("exist");
    cy.contains("button", "Adicionar ativo").click();
    cy.get('[role="dialog"]').should("be.visible").and("contain", "Adicionar ativo");
    cy.get('[role="dialog"]').find("#asset-class").should("be.visible");
    cy.get("#asset-ticker")
      .should("have.attr", "role", "combobox")
      .and("have.attr", "aria-autocomplete", "list")
      .and("have.attr", "aria-controls", "market-ticker-options")
      .and("have.attr", "aria-expanded", "false");
    cy.get("#asset-class").select("REAL_ESTATE_FUNDS");
    cy.get("#asset-ticker")
      .should("have.attr", "role", "combobox")
      .and("have.attr", "aria-autocomplete", "list");
    cy.get('[role="dialog"]').find('button[aria-label="Fechar"]').click();
    cy.get('[role="dialog"]').should("not.exist");
  });

  it("permite configurar uma chave brapi individual sem expor seu valor", () => {
    cy.visit("/configuracoes");
    cy.waitForHydration();
    cy.contains("h1", "Configurações").should("be.visible");
    cy.get("#settings-brapi-api-key").should("have.attr", "type", "password").and("have.attr", "autocomplete", "off");
    cy.contains("a", "Obter chave na brapi").should("have.attr", "href", "https://brapi.dev/dashboard");
    cy.contains("Yahoo Finance").should("be.visible");
    cy.contains("Binance").should("be.visible");
    cy.contains("Sem chave").should("be.visible");
  });

  it("exige seleção do catálogo Spot da Binance para criptomoedas", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-instrument").select("CRYPTO");
    cy.get("#asset-class").should("have.value", "CRYPTO");
    cy.get("#asset-ticker").type("BTC");
    cy.get('button[form="asset-modal-form"]').should("be.disabled");

    cy.get("#market-ticker-options", { timeout: 10000 })
      .should("be.visible")
      .and("contain", "BTC")
      .and("contain", "Cripto · Binance");
    cy.contains('[role="option"]', "BTC").click();
    cy.get("#asset-ticker").should("have.value", "BTC");
    cy.get("#asset-ticker-help").should("contain", "catálogo Spot da Binance");
    cy.get('button[form="asset-modal-form"]').should("be.enabled");
  });

  it("sugere FIIs da brapi sem recortar a lista pelo modal", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-class").select("REAL_ESTATE_FUNDS");
    cy.get("#asset-ticker").type("RBVA11");

    cy.get("#market-ticker-options", { timeout: 10000 }).should("be.visible");
    cy.contains('[role="option"]', "RBVA11")
      .should("be.visible")
      .find("img")
      .should("have.attr", "src")
      .and("include", "icons.brapi.dev");
    cy.contains('[role="option"]', "RBVA11").click();
    cy.get("#asset-ticker").should("have.value", "RBVA11");
  });

  it("exige uma opção do autocomplete e oculta tickers fracionários", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-ticker").type("ITAUSA");
    cy.get('button[form="asset-modal-form"]').should("be.disabled");

    cy.get("#market-ticker-options", { timeout: 10000 })
      .should("be.visible")
      .and("contain", "ITSA3")
      .and("contain", "ITSA4")
      .and("not.contain", "ITSA3F")
      .and("not.contain", "ITSA4F");

    cy.contains('[role="option"]', "ITSA4").click();
    cy.get('button[form="asset-modal-form"]').should("be.enabled");
  });

  it("abre os modais de pergunta, edição e restauração", () => {
    cy.contains("button", "Perguntas").click();
    cy.contains("button", "Adicionar pergunta").click();
    cy.get('[role="dialog"]').should("contain", "Adicionar pergunta");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();

    cy.contains("button", "Editar").first().click();
    cy.get('[role="dialog"]').should("contain", "Editar pergunta").and("contain", "Excluir pergunta");
    cy.get('[role="dialog"] button[aria-label="Fechar"]').click();

    cy.contains("button", "Restaurar padrões").click();
    cy.get('[role="dialog"]').should("contain", "Restaurar perguntas").and("contain", "Deseja seguir?");
  });

  it("preserva o estado local ao trocar de aba", () => {
    cy.contains("button", "Aportar").click();
    cy.get("#contribution-value").type("{selectall}4321");

    cy.contains("button", "Metas").click();
    cy.get('input[aria-label="Meta de Ações nacionais"]').type("{selectall}37");

    cy.contains("button", "Aportar").click();
    cy.get("#contribution-value").should("have.value", "4321");

    cy.contains("button", "Metas").click();
    cy.get('input[aria-label="Meta de Ações nacionais"]').should("have.value", "37");
  });

  it("cria, expande, pesquisa e mantém um grupo vazio de renda fixa", () => {
    cy.contains("button", "Renda fixa").click();
    cy.get("#fixed-family").should("contain", "Tesouro Direto").and("not.contain", "Tesouro IPCA+").and("not.contain", "Tesouro Selic");
    cy.get("#fixed-family").select("BANK_DEPOSITS_FGC");
    cy.get("#fixed-indexation").select("PRE_FIXED");
    cy.get("#fixed-score").type("{selectall}7");
    cy.get('button[form="fixed-income-group-form"]').click();
    cy.contains("Grupo de renda fixa adicionado.").should("be.visible");

    cy.get('button[aria-label^="Expandir Depósitos bancários com FGC"]').click();
    cy.contains("button", "Adicionar aplicação").click();
    cy.get("#holding-type").select("5");
    cy.get("#holding-issuer").type("Banco Exemplo");
    cy.get("#holding-product").type("CDB Exemplo 2029");
    cy.get("#holding-invested").type("1000");
    cy.get("#holding-current").type("{selectall}1025.50");
    cy.get("#holding-rate-convention").select("PERCENT_OF_INDEXER");
    cy.get("#holding-benchmark").type("CDI");
    cy.get("#holding-rate").type("110");
    cy.get("#holding-purchase-date").type("2026-01-10");
    cy.get("#holding-maturity-date").type("2029-01-10");
    cy.get('button[form="fixed-income-holding-form"]').click();
    cy.contains("Aplicação adicionada.").should("be.visible");
    cy.contains("CDB Exemplo 2029").should("be.visible");

    cy.get('button[aria-label^="Recolher Depósitos bancários com FGC"]').click();
    cy.contains("CDB Exemplo 2029").should("not.exist");
    cy.get('input[placeholder="Buscar nome ou ticker"]').type("CDB Exemplo 2029");
    cy.contains("CDB Exemplo 2029").should("be.visible");

    cy.contains("tr", "CDB Exemplo 2029").contains("button", "Excluir").click();
    cy.get('[role="dialog"]').contains("button", "Remover").click();
    cy.contains("CDB Exemplo 2029").should("not.exist");
    cy.get('input[placeholder="Buscar nome ou ticker"]').clear();
    cy.contains("Depósitos bancários com FGC · Pré-fixado").should("exist");
    cy.get('button[aria-label^="Expandir Depósitos bancários com FGC"]').click();
    cy.contains("Nenhuma aplicação cadastrada. O grupo continua elegível para receber aportes.").should("be.visible");
  });

  it("permite selecionar ETF e escolher uma exposição diferente", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-instrument").select("ETF");
    cy.get("#asset-class").should("not.be.disabled").select("FIXED_INCOME");
    cy.get("#asset-fixed-group").should("be.visible").select("PUBLIC_TREASURY");
    cy.get("#asset-fixed-indexation").select("INFLATION");
    cy.get("#asset-ticker").should("have.attr", "role", "combobox");
    cy.get("#asset-strength").should("be.visible").type("{selectall}8");
    cy.get('[role="dialog"]').should("contain", "Nota do ETF (manual)").and("not.contain", "ROE historicamente");
  });

  it("reproduz o modal operacional de novo aporte", () => {
    cy.contains("button", "Adicionar ativo").click();
    cy.get("#asset-class").select("INTERNATIONAL_STOCKS");
    cy.get("#asset-ticker").type("AAPL");
    cy.get("#market-ticker-options", { timeout: 10000 }).contains('[role="option"]', "AAPL").click();
    cy.get("#asset-quantity").type("{selectall}32");
    cy.get('button[form="asset-modal-form"]').click();
    cy.contains("Ativo adicionado.").should("be.visible");

    cy.get('button[aria-label="Editar AAPL"]').click();
    cy.get('[role="switch"]').click({ multiple: true });
    cy.get('button[form="asset-modal-form"]').click();
    cy.contains("Ativo atualizado.").should("be.visible");

    cy.contains("button", "Metas").click();
    cy.get('input[aria-label^="Meta de"]').each(($input) => cy.wrap($input).type("{selectall}0"));
    cy.get('input[aria-label="Meta de Ações internacionais"]').type("{selectall}100");
    cy.contains("button", "Salvar metas").click();
    cy.contains("Metas salvas.").should("be.visible");

    cy.contains("button", "Aportar").click();
    cy.contains("button", "Calcular").click();
    cy.get('table[aria-label="Sugestões de investimento"]').contains("tr", "AAPL").contains("button", "Aportar").click();

    cy.get('[role="dialog"]').should("contain", "Novo aporte");
    cy.get('[role="dialog"]').should("contain", "Unidades em carteira:").and("contain", "32");
    cy.get('[role="dialog"]').should("contain", "Quantidade a ser aportada:").and("contain", "Quantidade sugerida:");
    cy.get("#contribution-quantity").should("be.visible").type("{selectall}3");
    cy.get('[role="dialog"]').should("contain", "equivale a: R$");
  });
});
