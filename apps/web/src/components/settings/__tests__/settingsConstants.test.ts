import { describe, expect, test } from "bun:test";
import { englishMessages } from "@teak/i18n";

const PRO_FEATURES = Object.values(
  englishMessages.settings.subscription.features
);

describe("Pro features", () => {
  test("describes browser extension access without excluding Safari", () => {
    expect(PRO_FEATURES).toContain("Browser Extensions");
    expect(PRO_FEATURES).not.toContain("Chrome Extension");
  });

  test("lists the Android app alongside the Apple apps", () => {
    const apps = PRO_FEATURES.find((feature) => feature.includes("App"));
    expect(apps).toContain("Android");
    expect(apps).toContain("iOS");
  });
});
