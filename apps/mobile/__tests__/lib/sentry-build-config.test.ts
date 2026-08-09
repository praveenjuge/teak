import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mobileRoot = resolve(import.meta.dir, "../..");
const repositoryRoot = resolve(mobileRoot, "../..");

test("production mobile builds require Sentry uploads", () => {
  const app = JSON.parse(readFileSync(resolve(mobileRoot, "app.json"), "utf8"));
  const appConfig = readFileSync(resolve(mobileRoot, "app.config.js"), "utf8");
  const eas = JSON.parse(readFileSync(resolve(mobileRoot, "eas.json"), "utf8"));
  const metro = readFileSync(resolve(mobileRoot, "metro.config.js"), "utf8");
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8")
  );
  const store = JSON.parse(
    readFileSync(resolve(mobileRoot, "store.config.json"), "utf8")
  );

  expect(app.expo.version).toBeUndefined();
  expect(store.apple.version).toBeUndefined();
  expect(appConfig).toContain('require("../../package.json")');
  expect(appConfig).toContain("version: rootPackage.version");
  expect(app.expo.plugins).toContainEqual([
    "@sentry/react-native/expo",
    expect.objectContaining({
      disableAutoUpload: false,
      organization: "teakvault",
      project: "teak-mobile-prod",
    }),
  ]);
  expect(eas.build.production.env.SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
  expect(eas.build.production.env.SENTRY_ALLOW_FAILURE).toBe("false");
  expect(metro).toContain("getSentryExpoConfig");
  expect(packageJson.scripts["build:sentry"]).toContain(
    "sentry-cli build upload"
  );
  expect(packageJson.scripts["build:sentry"]).toContain("teak-mobile-prod");
});

test("uploads hosted production builds to Sentry before App Store Connect", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8")
  );
  const legacyWorkflowPath = resolve(
    repositoryRoot,
    ".github/workflows/mobile-size-analysis.yml"
  );
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/mobile-release.yml"),
    "utf8"
  );

  expect(existsSync(legacyWorkflowPath)).toBe(false);
  expect(packageJson.scripts["build:local"]).toBeUndefined();
  expect(packageJson.scripts["build:submit"]).toBeUndefined();
  expect(packageJson.scripts["build:sentry"]).toContain(
    "sentry-cli build upload"
  );
  expect(workflow.indexOf("Upload IPA to Sentry Size Analysis")).toBeLessThan(
    workflow.indexOf("Upload IPA with asc")
  );
});

test("pins the Expo 56 macro-compatible native build set", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8")
  );
  const repositoryPackage = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8")
  );
  const lockfile = readFileSync(resolve(repositoryRoot, "bun.lock"), "utf8");

  expect(packageJson.dependencies.expo).toBe("~56.0.15");
  expect(packageJson.dependencies["expo-build-properties"]).toBe("~56.0.22");
  expect(repositoryPackage.overrides["expo-constants"]).toBe("56.0.20");
  expect(repositoryPackage.overrides["expo-font"]).toBe("56.0.7");
  expect(repositoryPackage.overrides["expo-linking"]).toBe("56.0.15");
  expect(lockfile).toContain('"@expo/expo-modules-macros-plugin@0.2.2"');
  expect(lockfile).not.toContain('"@expo/expo-modules-macros-plugin@0.0.9"');
});
