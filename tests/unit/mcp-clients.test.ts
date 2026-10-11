import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { mcpOAuthClient: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { resolveMcpClient } from "@/features/mcp/clients";

const clientId = "https://chatgpt.com/oauth/client.json";
const callback = "https://chatgpt.com/connector_platform_oauth_redirect";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    client_name: "ChatGPT",
    redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    ...overrides,
  };
}

function respond(payload: unknown) {
  mocks.fetch.mockResolvedValue(Response.json(payload));
}

describe("MCP OAuth client metadata compatibility and transport safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockImplementation(async (input) => ({ ...input.create, updatedAt: new Date() }));
    respond(metadata());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("accepts public none from the supported-methods list even when the legacy preference is private_key_jwt", async () => {
    respond(metadata({
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_method: "private_key_jwt",
    }));
    const result = await resolveMcpClient(clientId);
    expect(result).toMatchObject({ id: clientId, name: "ChatGPT", redirectUris: [callback], metadataUrl: clientId });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: clientId },
      create: { id: clientId, name: "ChatGPT", redirectUris: [callback], metadataUrl: clientId },
      update: { name: "ChatGPT", redirectUris: [callback] },
    });
  });

  it("accepts plural supported methods without requiring the optional legacy method", async () => {
    const publicMetadata = metadata({ token_endpoint_auth_methods_supported: ["private_key_jwt", "none"] });
    delete (publicMetadata as Record<string, unknown>).token_endpoint_auth_method;
    respond(publicMetadata);
    expect(await resolveMcpClient(clientId)).toMatchObject({ id: clientId });
  });

  it("accepts legacy public-client none metadata", async () => {
    expect(await resolveMcpClient(clientId)).toMatchObject({ id: clientId, redirectUris: [callback] });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("rejects a private-only legacy client when no supported-methods list permits none", async () => {
    respond(metadata({ token_endpoint_auth_method: "private_key_jwt" }));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects plural supported methods without a public none intersection", async () => {
    respond(metadata({ token_endpoint_auth_methods_supported: ["private_key_jwt"], token_endpoint_auth_method: "private_key_jwt" }));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("requires the metadata client_id to match the exact requested document URL", async () => {
    respond(metadata({ client_id: "https://chatgpt.com/oauth/different/client.json" }));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reuses registered public clients without fetching any metadata URL", async () => {
    const stored = { id: "registered-client", name: "Local agent", redirectUris: ["http://127.0.0.1/callback"], metadataUrl: null, updatedAt: new Date(0) };
    mocks.findUnique.mockResolvedValue(stored);
    expect(await resolveMcpClient(stored.id)).toBe(stored);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reuses fresh shared metadata and re-resolves stale metadata", async () => {
    const stored = { id: clientId, name: "ChatGPT", redirectUris: [callback], metadataUrl: clientId, updatedAt: new Date() };
    mocks.findUnique.mockResolvedValue(stored);
    expect(await resolveMcpClient(clientId)).toBe(stored);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue({ ...stored, updatedAt: new Date(Date.now() - 61 * 60_000) });
    respond(metadata({ client_name: "ChatGPT refreshed" }));
    expect(await resolveMcpClient(clientId)).toMatchObject({ name: "ChatGPT refreshed" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "https://127.0.0.1/private", "https://169.254.169.254/latest/meta-data/",
    "https://chatgpt.com/private", "http://chatgpt.com/oauth/client.json",
  ])("does not fetch untrusted client metadata: %s", async (id) => {
    await expect(resolveMcpClient(id)).rejects.toMatchObject({ code: "invalid_client" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("uses redirect:error and no-store with a bounded timeout for the allowlisted request", async () => {
    await resolveMcpClient(clientId);
    expect(mocks.fetch).toHaveBeenCalledWith(clientId, {
      redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
    });
  });

  it.each([302, 403, 451, 500])("does not persist metadata after HTTP %s", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("Unavailable", { status }));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("never follows a metadata redirect or retries a failed transport", async () => {
    mocks.fetch.mockRejectedValue(new Error("Redirect blocked"));
    await expect(resolveMcpClient(clientId)).rejects.toThrow("Redirect blocked");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].redirect).toBe("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects oversized metadata from declared and actual streamed byte counts", async () => {
    mocks.fetch.mockResolvedValue(Response.json(metadata(), { headers: { "content-length": "16385" } }));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16_385)); }, cancel });
    mocks.fetch.mockResolvedValue(new Response(stream));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an empty response or invalid JSON without persisting a client", async () => {
    mocks.fetch.mockResolvedValue(new Response(null));
    await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    mocks.fetch.mockResolvedValue(new Response("<html>not metadata</html>"));
    await expect(resolveMcpClient(clientId)).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("bounds callback counts and rejects missing, long, insecure or wildcard callbacks", async () => {
    for (const redirectUris of [[], Array.from({ length: 11 }, (_, index) => `${callback}/${index}`), [`https://agent.example/callback?x=${"x".repeat(2048)}`], ["http://agent.example/callback"], ["https://*.agent.example/callback"]]) {
      respond(metadata({ redirect_uris: redirectUris }));
      await expect(resolveMcpClient(clientId)).rejects.toThrow();
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("validates names and grant types before updating metadata", async () => {
    for (const invalid of [{ client_name: " " }, { client_name: "x".repeat(101) }, { grant_types: ["client_credentials"] }]) {
      respond(metadata(invalid));
      await expect(resolveMcpClient(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
