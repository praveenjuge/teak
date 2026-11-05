import { describe, expect, test } from "bun:test";
import {
  SETTINGS_SECTIONS,
  settingsSectionForPath,
  visibleSettingsSections,
} from "../settingsSections";

describe("settingsSectionForPath", () => {
  test.each([
    ["/settings", "account"],
    ["/settings/", "account"],
    ["/settings/plan", "plan"],
    ["/settings/appearance", "appearance"],
    ["/settings/integrations", "integrations"],
    ["/settings/security", "security"],
    ["/settings/data", "data"],
  ])("%s is the %s page", (path, id) => {
    expect(settingsSectionForPath(path)?.id).toBe(id as never);
  });

  test.each([null, undefined, "/", "/settingsx", "/settings/unknown", "/tags"])(
    "%p is not a Settings page",
    (path) => {
      expect(settingsSectionForPath(path)).toBeNull();
    }
  );

  test("every page has its own address", () => {
    const hrefs = SETTINGS_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("visibleSettingsSections", () => {
  test("lists Plan only where the deployment sells plans", () => {
    expect(visibleSettingsSections(true)).toEqual(SETTINGS_SECTIONS);
    expect(visibleSettingsSections(false).map(({ id }) => id)).toEqual([
      "account",
      "appearance",
      "integrations",
      "security",
      "data",
    ]);
  });
});
