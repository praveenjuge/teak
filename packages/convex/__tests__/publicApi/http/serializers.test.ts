import { afterEach, describe, expect, test } from "bun:test";
import { getAppBaseUrl } from "../../../publicApi/http/serializers";

const original = {
  SITE_URL: process.env.SITE_URL,
  TEAK_DEV_DEPLOYMENT: process.env.TEAK_DEV_DEPLOYMENT,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const API_REQUEST = "https://api.selfhost.example/v1/cards";

describe("getAppBaseUrl", () => {
  test("a self-hosted deployment links to its own web app", () => {
    delete process.env.TEAK_DEV_DEPLOYMENT;
    process.env.SITE_URL = "https://app.selfhost.example/";
    expect(getAppBaseUrl(API_REQUEST)).toBe("https://app.selfhost.example");
  });

  test.each([
    "https://teakvault.com",
    "https://app.teakvault.com",
    undefined,
    "not a url",
    "ftp://app.selfhost.example",
  ])("SITE_URL %p keeps Teak's own app", (siteUrl) => {
    delete process.env.TEAK_DEV_DEPLOYMENT;
    if (siteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = siteUrl;
    }
    expect(getAppBaseUrl("https://teakvault.com/api/v1/cards")).toBe(
      "https://app.teakvault.com"
    );
  });
});
