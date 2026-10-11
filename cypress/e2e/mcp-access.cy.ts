const callbackUrl = "https://mcp-cypress.example/callback";
const verifier = "uovp-cypress-pkce-verifier-for-read-only-mcp-tests";

function enableMcp() {
  cy.get('[data-testid="mcp-settings"]').within(() => {
    cy.contains("button", "Habilitar MCP").should("be.enabled").click();
    cy.contains("MCP habilitado.").should("be.visible");
    cy.get("#mcp-endpoint").invoke("val").as("mcpResource", { type: "static" });
  });
}

function registerClient() {
  cy.get('[data-testid="mcp-settings"]').within(() => {
    cy.contains("summary", "Cliente personalizado").click();
    cy.get("#mcp-client-name").type("Agente MCP Cypress");
    cy.get("#mcp-client-redirects").type(callbackUrl);
    cy.contains("button", "Cadastrar cliente").click();
    cy.get("#mcp-registered-client").should("not.have.value", "").invoke("val").as("mcpClientId", { type: "static" });
  });
}

function visitConsent() {
  cy.window().then(async (win) => {
    const digest = await win.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }).then((challenge) => {
    cy.get<string>("@mcpResource").then((resource) => {
      cy.get<string>("@mcpClientId").then((clientId) => {
        const query = new URLSearchParams({
          response_type: "code", client_id: clientId, redirect_uri: callbackUrl,
          scope: "accounts:read transactions:read", state: "cypress-mcp-state",
          resource, code_challenge: challenge, code_challenge_method: "S256",
        });
        cy.visit(`/mcp/authorize?${query}`);
        cy.waitForHydration();
      });
    });
  });
}

function interceptCallback() {
  cy.intercept("GET", `${callbackUrl}*`, {
    statusCode: 200,
    headers: { "content-type": "text/html" },
    body: "<!doctype html><html><body>OAuth callback received</body></html>",
  }).as("mcpCallback");
}

describe("acesso somente leitura por MCP", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.visit("/configuracoes");
    cy.waitForHydration();
  });

  it("começa desabilitado, mantém a escolha após reload e confirma a revogação ao desabilitar", () => {
    cy.get('[data-testid="mcp-settings"]').within(() => {
      cy.contains("button", "Habilitar MCP").should("have.attr", "aria-pressed", "false");
      cy.contains("Nenhum agente autorizado.").should("be.visible");
      cy.contains("não apaga dados já enviados").should("be.visible");
    });
    enableMcp();
    cy.reload();
    cy.waitForHydration();
    cy.get('[data-testid="mcp-settings"]').contains("button", "Desabilitar MCP").click();
    cy.get('[role="dialog"]').within(() => {
      cy.contains("Desabilitar acesso por MCP?").should("be.visible");
      cy.contains("button", "Cancelar").click();
    });
    cy.get('[data-testid="mcp-settings"]').contains("button", "Desabilitar MCP").click();
    cy.get('[role="dialog"]').contains("button", "Desabilitar e revogar").click();
    cy.get('[data-testid="mcp-settings"]').contains("button", "Habilitar MCP").should("have.attr", "aria-pressed", "false");
  });

  it("permite recusar o consentimento sem criar autorização", () => {
    enableMcp();
    registerClient();
    interceptCallback();
    visitConsent();
    cy.get('[data-testid="mcp-consent"]').within(() => {
      cy.contains("Agente MCP Cypress").should("be.visible");
      cy.get('input[value="accounts:read"]').should("be.checked");
      cy.contains("Somente leitura.").should("be.visible");
      cy.contains("button", "Não permitir").click();
    });
    cy.wait("@mcpCallback").then(({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get("error")).to.eq("access_denied");
      expect(query.get("state")).to.eq("cypress-mcp-state");
      expect(query.has("code")).to.eq(false);
    });
    cy.visit("/configuracoes");
    cy.waitForHydration();
    cy.get('[data-testid="mcp-settings"]').contains("Nenhum agente autorizado.").should("be.visible");
  });

  it("autoriza apenas os escopos selecionados, obtém token e o invalida ao revogar", () => {
    enableMcp();
    registerClient();
    interceptCallback();
    visitConsent();
    cy.get('[data-testid="mcp-consent"]').within(() => {
      cy.get('input[value="transactions:read"]').uncheck();
      cy.contains("button", "Autorizar leitura").click();
    });
    cy.wait("@mcpCallback").then(({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get("state")).to.eq("cypress-mcp-state");
      expect(query.get("code")).to.be.a("string").and.have.length.greaterThan(0);
      cy.get<string>("@mcpClientId").then((clientId) => {
        cy.get<string>("@mcpResource").then((resource) => {
          cy.request({
            method: "POST", url: new URL("/api/mcp/oauth/token", resource).toString(), form: true,
            body: { grant_type: "authorization_code", code: query.get("code"), client_id: clientId, redirect_uri: callbackUrl, code_verifier: verifier, resource },
          }).then(({ body }) => {
            expect(body.scope).to.eq("accounts:read");
            expect(body.access_token).to.be.a("string").and.have.length.greaterThan(0);
            cy.wrap(body.access_token, { log: false }).as("mcpAccessToken", { type: "static" });
          });
        });
      });
    });
    cy.visit("/configuracoes");
    cy.waitForHydration();
    cy.get<string>("@mcpAccessToken").then((token) => {
      cy.get<string>("@mcpResource").then((resource) => {
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        };
        cy.request({
          method: "POST", url: resource, headers, log: false,
          body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Cypress", version: "1" } } },
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          expect(body.result.serverInfo.name).to.eq("uovp");
          expect(body).not.to.have.property("error");
        });
        cy.request({
          method: "POST", url: resource, headers, log: false,
          body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          const names = body.result.tools.map((tool: { name: string }) => tool.name).sort();
          expect(names).to.deep.eq(["fetch", "get_card_invoices", "list_accounts", "search"]);
          expect(names).not.to.include("list_transactions");
          expect(names).not.to.include("get_financial_summary");
        });
        cy.request({
          method: "POST", url: resource, headers, log: false,
          body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_accounts", arguments: {} } },
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          expect(body).not.to.have.property("error");
          expect(body.result.isError).not.to.eq(true);
          expect(body.result.structuredContent.context.readOnly).to.eq(true);
        });
      });
    });
    cy.get('[data-testid="mcp-grant"]').within(() => {
      cy.contains("Agente MCP Cypress").should("be.visible");
      cy.contains("Contas, cartões e faturas").should("be.visible");
      cy.contains("Transações individuais").should("not.exist");
      cy.contains("button", "Revogar acesso").click();
    });
    cy.get('[role="dialog"]').contains("button", "Revogar acesso").click();
    cy.get('[data-testid="mcp-grant"]').should("not.exist");
    cy.get<string>("@mcpAccessToken").then((token) => {
      cy.request({
        method: "POST", url: "/api/mcp", failOnStatusCode: false, log: false,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Cypress", version: "1" } } },
      }).its("status").should("eq", 401);
    });
  });

  it("rejeita callbacks e autorizações inválidos sem erro de renderização e cabe no celular", () => {
    cy.viewport(390, 844);
    enableMcp();
    cy.get('[data-testid="mcp-settings"]').within(() => {
      cy.contains("summary", "Cliente personalizado").click();
      cy.get("#mcp-client-name").type("Cliente inválido");
      cy.get("#mcp-client-redirects").type("http://untrusted.example/callback");
      cy.contains("button", "Cadastrar cliente").click();
      cy.get('[role="alert"]').should("contain.text", "Não foi possível cadastrar");
    });
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(390));
    cy.visit("/mcp/authorize?client_id=unknown&redirect_uri=https%3A%2F%2Funtrusted.example");
    cy.contains("Não foi possível autorizar").should("be.visible");
    cy.contains("a", "Ir para Configurações").should("be.visible");
  });
});
