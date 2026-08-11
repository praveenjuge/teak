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
  expect(appConfig).toContain("TEAK_IOS_BUILD_NUMBER");
  expect(app.expo.plugins).toContainEqual([
    "@sentry/react-native/expo",
    expect.objectContaining({
      disableAutoUpload: false,
      organization: "teakvault",
      project: "teak-mobile-prod",
    }),
  ]);
  expect(app.expo.ios.entitlements["keychain-access-groups"]).toEqual([
    "$(AppIdentifierPrefix)com.praveenjuge.teak",
  ]);
  expect(eas.build.production.env.SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
  expect(eas.build.production.env.SENTRY_ALLOW_FAILURE).toBe("false");
  expect(eas.cli.appVersionSource).toBeUndefined();
  expect(eas.build.production.autoIncrement).toBeUndefined();
  expect(metro).toContain("getSentryExpoConfig");
  expect(packageJson.scripts["build:sentry"]).toContain(
    "sentry-cli build upload"
  );
  expect(packageJson.scripts["build:sentry"]).toContain("teak-mobile-prod");
});

test("uploads runner-local production builds to Sentry before App Store Connect", () => {
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
  const archiveStep = workflow.slice(
    workflow.indexOf("- name: Archive and export the production IPA"),
    workflow.indexOf("- name: Verify the exact local IPA identity")
  );
  const ipaVerificationStep = workflow.slice(
    workflow.indexOf("- name: Verify the exact local IPA identity"),
    workflow.indexOf("- name: Upload IPA to mandatory Sentry Size Analysis")
  );

  expect(existsSync(legacyWorkflowPath)).toBe(false);
  expect(packageJson.scripts["build:submit"]).toBeUndefined();
  expect(packageJson.scripts["build:sentry"]).toContain(
    "sentry-cli build upload"
  );
  expect(
    workflow.indexOf("Upload local IPA to Sentry Size Analysis")
  ).toBeLessThan(workflow.indexOf("Upload local IPA with asc"));
  expect(workflow).toContain("bunx expo prebuild --platform ios");
  expect(workflow).toContain("xcodebuild");
  expect(workflow).not.toContain("eas-cli");
  expect(workflow).not.toContain("EXPO_TOKEN");
  expect(workflow).not.toContain("EAS_CLI_VERSION");
  expect(workflow).toContain("EXPO_PUBLIC_CONVEX_URL");
  expect(workflow).toContain("EXPO_PUBLIC_CONVEX_SITE_URL");
  expect(workflow).toContain("secrets.SENTRY_MOBILE_DSN");
  expect(archiveStep).toContain("EXPO_PUBLIC_SENTRY_MOBILE_DSN");
  expect(archiveStep).toContain("xcodebuild");
  expect(ipaVerificationStep).toContain(
    'main_bundle="$app_path/main.jsbundle"'
  );
  expect(ipaVerificationStep).toContain(
    'grep -aFq "$expected_runtime_value" "$main_bundle"'
  );
  expect(workflow).toContain("codesign -d --entitlements :-");
  expect(workflow).toContain(
    'keychain_access_group" != "$APPLE_TEAM_ID.$IOS_APP_BUNDLE_ID"'
  );
});

test("pins the Expo 57 macro-compatible native build set", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8")
  );
  const repositoryPackage = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8")
  );
  const lockfile = readFileSync(resolve(repositoryRoot, "bun.lock"), "utf8");

  expect(packageJson.dependencies.expo).toBe("^57.0.0");
  expect(packageJson.dependencies["expo-build-properties"]).toBe("~57.0.9");
  expect(packageJson.dependencies["react-native"]).toBe("0.86.2");
  expect(packageJson.dependencies["react-native-reanimated"]).toBe("4.5.1");
  expect(packageJson.dependencies["react-native-worklets"]).toBe("0.10.1");
  expect(repositoryPackage.overrides["expo-constants"]).toBeUndefined();
  expect(repositoryPackage.overrides["expo-font"]).toBeUndefined();
  expect(repositoryPackage.overrides["expo-linking"]).toBeUndefined();
  expect(repositoryPackage.overrides["expo-web-browser"]).toBeUndefined();
  expect(lockfile).toContain('"@expo/expo-modules-macros-plugin@0.6.1"');
  expect(lockfile).not.toContain('"@expo/expo-modules-macros-plugin@0.2.2"');
});
