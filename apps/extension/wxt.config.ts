import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { FIREFOX_SENDS_TELEMETRY, missingBuildEnvError } from "./lib/env";
import { OMNIBOX_KEYWORD } from "./lib/omnibox";
import { SAVE_PAGE_COMMAND } from "./lib/saveShortcut";

/** Pins the Chrome extension id, so OAuth redirects and the store item match. */
const CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkgJrENYninAOCgkpb9LcU6i5/lDbBjNjWBi0VF8iRg+Ha91Gx/0S9jtL1h36kAGXetcNvxXeJ95UE+HG9Dd8UfyhM9kuBh+o6/zsu8L7vFdVOH1EdVPvO15jVoa2e8DOYz/f0EN/FJ7G6QDm411110NHxVleQc0SEe35FZwTDTX6T1lC9XeYtE+y6eU+fUlLZF1/JJL+lIlXjaLnB4QQTJhK9KQvOi2LVtFUHUYVYV/Jebj3VFdj8gOVS2iTIfYrcb0oInFCwxnBStflQR9604XAqZBUt2KEWgO9V/cUHmdfoHHmXZ7k/1+d498nA7tKg1O9+0eZUUDlxmtv5jOM4QIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  hooks: {
    // WXT has loaded the .env files into process.env by now. CI (where
    // release bundles are built) stops rather than ship a bundle that can't
    // reach Teak; a local build, such as the pre-commit hook's in a checkout
    // that never ran extension setup, warns instead of blocking the commit.
    "build:before": () => {
      const error = missingBuildEnvError(process.env);
      if (!error) {
        return;
      }
      if (process.env.CI) {
        throw new Error(error);
      }
      console.warn(`\n⚠ ${error}\n`);
    },
  },
  // Firefox gets no Chrome `key` or object `author` (it accepts only a
  // string), and declares the data it sends for its install prompt.
  manifest: ({ browser }) => ({
    // From `public/_locales/<locale>/messages.json`, in the browser's language.
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    // version intentionally omitted. WXT reads it from package.json so the
    // monorepo version bump drives extension releases.
    ...(browser === "firefox"
      ? {}
      : { author: { email: "hi@praveenjuge.com" } }),
    homepage_url: "https://teakvault.com",
    browser_specific_settings: {
      gecko: {
        id: "teak@teakvault.com",
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: ["websiteContent", "browsingActivity", "searchTerms"],
          ...(FIREFOX_SENDS_TELEMETRY
            ? { optional: ["technicalAndInteraction"] }
            : {}),
        },
      },
    },
    permissions: [
      "identity",
      "storage",
      "activeTab",
      "tabs",
      "contextMenus",
      "scripting",
    ],
    host_permissions: ["<all_urls>"],
    omnibox: { keyword: OMNIBOX_KEYWORD },
    commands: {
      [SAVE_PAGE_COMMAND]: {
        suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" },
        description: "Save this page to Teak",
      },
    },
    action: {
      default_title: "Save to Teak",
      // Firefox otherwise keeps the button in the extensions menu, a click
      // further away than Chrome's pinned button.
      ...(browser === "firefox" ? { default_area: "navbar" } : {}),
    },
    ...(browser === "firefox" ? {} : { key: CHROME_KEY }),
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
  }),
  // AMO rebuilds the Firefox add-on from this archive, so it holds the
  // workspace packages the bundle imports and every workspace manifest the
  // lockfile names. `release.md` has the build steps for reviewers.
  zip: {
    sourcesRoot: "../..",
    includeSources: [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "LICENSE",
      "apps/*/package.json",
      "packages/*/package.json",
      "apps/extension/**",
      "packages/convex/**",
      "packages/files-protocol/**",
      "packages/i18n/**",
      "packages/sdk/**",
    ],
    excludeSources: [
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/node_modules/**",
      "apps/extension/.output/**",
      "packages/sdk/dist/**",
      "packages/convex/_generated/ai/**",
      "packages/convex/card/onboarding/**",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
