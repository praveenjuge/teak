// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { resolveDesktopConfig } from "../lib/desktop-config";

const requiredEnv = {
  VITE_PUBLIC_CONVEX_SITE_URL: "https://teak.example.com/path?foo=bar#hash",
  VITE_PUBLIC_CONVEX_URL: "https://happy-animal-123.convex.cloud/path",
};

describe("desktop config", () => {
  it("uses the dev web fallback when VITE_WEB_URL is missing", () => {
    const config = resolveDesktopConfig({
      ...requiredEnv,
      DEV: true,
    });

    expect(config.webBaseUrl).toBe("http://app.teak.localhost:1355");
  });

  it("uses the production web fallback when VITE_WEB_URL is missing", () => {
    const config = resolveDesktopConfig({
      ...requiredEnv,
      DEV: false,
    });

    expect(config.webBaseUrl).toBe("https://app.teakvault.com");
  });

  it("normalizes configured base URLs", () => {
    const config = resolveDesktopConfig({
      DEV: false,
      VITE_PUBLIC_CONVEX_SITE_URL:
        "https://teak.example.com/path/to/auth?foo=bar#hash",
      VITE_PUBLIC_CONVEX_URL:
        "https://happy-animal-123.convex.cloud/deployment?foo=bar#hash",
      VITE_WEB_URL: "https://app.example.com/settings?tab=billing#section",
    });

    expect(config.webBaseUrl).toBe("https://app.example.com");
    expect(config.buildWebUrl("/settings")).toBe(
      "https://app.example.com/settings"
    );
    expect(config.convexSiteBaseUrl).toBe("https://teak.example.com");
    expect(config.convexUrl).toBe("https://happy-animal-123.convex.cloud");
  });

  it("throws for invalid configured URLs", () => {
    expect(() =>
      resolveDesktopConfig({
        ...requiredEnv,
        DEV: false,
        VITE_WEB_URL: "not-a-url",
      })
    ).toThrow("Invalid VITE_WEB_URL");
  });

  it("throws for missing required Convex configuration", () => {
    expect(() =>
      resolveDesktopConfig({
        DEV: false,
        VITE_PUBLIC_CONVEX_SITE_URL: undefined,
        VITE_PUBLIC_CONVEX_URL: requiredEnv.VITE_PUBLIC_CONVEX_URL,
      })
    ).toThrow("Missing VITE_PUBLIC_CONVEX_SITE_URL in desktop environment");
  });
});
