import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TEAK_DEV_API_URL,
  DEFAULT_TEAK_DEV_APP_URL,
  DEFAULT_TEAK_DEV_DOCS_URL,
  isLocalDevelopmentHostname,
  isLocalDevelopmentUrl,
  resolveTeakDevApiUrl,
  resolveTeakDevAppUrl,
  resolveTeakDevDocsUrl,
} from "./dev-urls";

describe("dev URL config", () => {
  test("uses the canonical Teak local defaults", () => {
    expect(resolveTeakDevAppUrl()).toBe(DEFAULT_TEAK_DEV_APP_URL);
    expect(resolveTeakDevApiUrl()).toBe(DEFAULT_TEAK_DEV_API_URL);
    expect(resolveTeakDevDocsUrl()).toBe(DEFAULT_TEAK_DEV_DOCS_URL);
  });

  test("normalizes overridden environment URLs", () => {
    expect(
      resolveTeakDevAppUrl({
        TEAK_DEV_APP_URL: "http://custom.teak.localhost:2468/path?tab=1#hash",
      })
    ).toBe("http://custom.teak.localhost:2468");
    expect(
      resolveTeakDevApiUrl({
        TEAK_DEV_API_URL: "http://api.custom.localhost:7777/v1",
      })
    ).toBe("http://api.custom.localhost:7777");
  });

  test("recognizes localhost and .localhost development hosts", () => {
    expect(isLocalDevelopmentHostname("localhost")).toBe(true);
    expect(isLocalDevelopmentHostname("127.0.0.1")).toBe(true);
    expect(isLocalDevelopmentHostname("app.teak.localhost")).toBe(true);
    expect(isLocalDevelopmentHostname("app.teakvault.com")).toBe(false);
    expect(isLocalDevelopmentUrl("http://app.teak.localhost:1355")).toBe(true);
    expect(isLocalDevelopmentUrl("https://app.teakvault.com")).toBe(false);
  });
});
