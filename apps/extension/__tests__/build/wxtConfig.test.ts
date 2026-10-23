import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { SAVE_PAGE_COMMAND } from "../../lib/saveShortcut";
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

type Manifest = {
  author?: unknown;
  browser_specific_settings?: {
    gecko?: {
      data_collection_permissions?: { required?: string[] };
      id?: string;
      strict_min_version?: string;
    };
  };
  commands?: Record<
    string,
    { description?: string; suggested_key?: Record<string, string> }
  >;
  key?: string;
  omnibox?: { keyword?: string };
};

const manifestFor = (browser: "chrome" | "firefox"): Manifest => {
  const manifest = config.manifest;
  if (typeof manifest !== "function") {
    throw new Error("wxt.config.ts manifest is not built per browser");
  }
  return manifest({ browser } as never) as Manifest;
};

describe("manifest", () => {
  test.each(["chrome", "firefox"] as const)(
    "%s claims the `teak` keyword for address-bar search",
    (browser) => {
      expect(manifestFor(browser).omnibox?.keyword).toBe("teak");
    }
  );

  test.each(["chrome", "firefox"] as const)(
    "%s binds Alt+Shift+S to the command the background saves the page on",
    (browser) => {
      const command = manifestFor(browser).commands?.[SAVE_PAGE_COMMAND];
      expect(command?.suggested_key).toEqual({
        default: "Alt+Shift+S",
        mac: "Alt+Shift+S",
      });
      expect(command?.description).toBe("Save this page to Teak");
    }
  );

  test("Chrome keeps its pinned key and author", () => {
    const chrome = manifestFor("chrome");
    expect(chrome.key).toMatch(/^MIIB/);
    expect(chrome.author).toEqual({ email: "hi@praveenjuge.com" });
  });

  test("Firefox has its add-on id, no Chrome key or object author, and declares the data it sends", () => {
    const firefox = manifestFor("firefox");
    expect(firefox.key).toBeUndefined();
    expect(firefox.author).toBeUndefined();
    expect(firefox.browser_specific_settings?.gecko).toEqual({
      id: "teak@teakvault.com",
      strict_min_version: "140.0",
      data_collection_permissions: {
        required: ["websiteContent", "browsingActivity", "searchTerms"],
      },
    });
  });
});
