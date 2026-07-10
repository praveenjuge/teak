import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mobileRoot = resolve(import.meta.dir, "../..");

test("production mobile builds require Sentry uploads", () => {
  const app = JSON.parse(readFileSync(resolve(mobileRoot, "app.json"), "utf8"));
  const eas = JSON.parse(readFileSync(resolve(mobileRoot, "eas.json"), "utf8"));
  const metro = readFileSync(resolve(mobileRoot, "metro.config.js"), "utf8");
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8")
  );
  const store = JSON.parse(
    readFileSync(resolve(mobileRoot, "store.config.json"), "utf8")
  );

  expect(app.expo.version).toBe(packageJson.version);
  expect(store.apple.version).toBe(packageJson.version);
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
});
