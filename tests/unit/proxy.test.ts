import { type NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const event = {} as NextFetchEvent;

describe("application request proxy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects POST to the redirect-only root before processing actions", async () => {
    const request = new NextRequest("https://uovp.example/?from=app", { method: "POST" });
    const response = await proxy(request, event);
    expect(response).toMatchObject({ status: 405 });
    expect(response instanceof Response && response.headers.get("allow")).toBe("GET, HEAD");
    expect(auth).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"])("passes root %s through to the existing redirect page", async (method) => {
    const request = new NextRequest("https://uovp.example/", { method });
    const response = await proxy(request, event);
    expect(response instanceof Response && response.headers.get("x-middleware-next")).toBe("1");
    expect(auth).not.toHaveBeenCalled();
  });

  it("keeps protected Server Actions behind the original NextAuth middleware", async () => {
    const request = new NextRequest("https://uovp.example/carteira", { method: "POST" });
    const denied = NextResponse.redirect(new URL("/login", request.url));
    auth.mockResolvedValue(denied);
    expect(await proxy(request, event)).toBe(denied);
    expect(auth).toHaveBeenCalledWith(request, event);
  });
});
