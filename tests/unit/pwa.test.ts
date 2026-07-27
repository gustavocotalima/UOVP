import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { isIosLike, isStandaloneMode } from "@/lib/pwa";

describe("PWA instalável", () => {
  it("expõe um manifesto standalone completo sem declarar service worker", () => {
    const value = manifest();

    expect(value).toMatchObject({
      name: "UOVP — Uma Outra Verdade Possível",
      short_name: "UOVP",
      start_url: "/home?source=pwa",
      scope: "/",
      display: "standalone",
      background_color: "#11120f",
      theme_color: "#11120f",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]));
    expect(value).not.toHaveProperty("serviceworker");
  });

  it("detecta iPhone, iPad e iPadOS sem marcar desktop comum", () => {
    expect(isIosLike({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isIosLike({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isIosLike({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    })).toBe(false);
  });

  it("detecta execução standalone pelo media query ou pelo Safari", () => {
    expect(isStandaloneMode({ displayModeMatches: true })).toBe(true);
    expect(isStandaloneMode({ displayModeMatches: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneMode({ displayModeMatches: false, navigatorStandalone: false })).toBe(false);
  });
});
