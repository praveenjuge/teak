import { afterEach, describe, expect, spyOn, test } from "bun:test";
import config from "../../wxt.config";

const NAME = "VITE_PUBLIC_CONVEX_SITE_URL";
const original = { [NAME]: process.env[NAME], CI: process.env.CI };

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const runBuildBeforeHook = () => {
  const hooks = config.hooks as Record<string, unknown> | undefined;
  const hook = hooks?.["build:before"];
  if (typeof hook !== "function") {
    throw new Error("wxt.config.ts has no build:before hook");
  }
  return hook({} as never);
};

describe("wxt build", () => {
  test("fails in CI with setup instructions when the Convex site URL is missing", () => {
    process.env.CI = "true";
    delete process.env[NAME];
    expect(runBuildBeforeHook).toThrow("bun run setup --target extension");
  });

  test("fails in CI when the Convex site URL is blank", () => {
    process.env.CI = "true";
    process.env[NAME] = "  ";
    expect(runBuildBeforeHook).toThrow(NAME);
  });

  test("warns instead of failing a local build without the Convex site URL", () => {
    delete process.env.CI;
    delete process.env[NAME];
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(runBuildBeforeHook).not.toThrow();
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "bun run setup --target extension"
      );
    } finally {
      warn.mockRestore();
    }
  });

  test("builds when the Convex site URL is set", () => {
    process.env[NAME] = "https://example.convex.site";
    expect(runBuildBeforeHook).not.toThrow();
  });
});

describe("manifest", () => {
  test("claims the `teak` keyword for address-bar search", () => {
    const manifest = config.manifest as { omnibox?: { keyword?: string } };
    expect(manifest.omnibox?.keyword).toBe("teak");
  });
});
