import { describe, expect, test } from "bun:test";
import { DEFAULT_TEAK_DEV_APP_URL } from "../devUrls";
import {
  buildTrustedOrigins,
  EXACT_TEAK_CALLBACK_URL,
} from "../trustedOrigins";

describe("buildTrustedOrigins", () => {
  test("production origins exclude localhost and teak wildcards", () => {
    const origins = buildTrustedOrigins("https://app.teakvault.com", {});

    expect(origins).toContain("https://app.teakvault.com");
    expect(origins).toContain(EXACT_TEAK_CALLBACK_URL);
    expect(origins).not.toContain("teak://*");
    expect(origins).not.toContain("http://localhost:1420");
    expect(origins).not.toContain("exp+teak://*");
    expect(origins).not.toContain(DEFAULT_TEAK_DEV_APP_URL);
  });

  test("local deployments keep Expo wildcards and the local app origin", () => {
    const origins = buildTrustedOrigins("http://app.teak.localhost:1355", {
      TEAK_DEV_APP_URL: "http://app.teak.localhost:1355",
    });

    expect(origins).toContain("http://app.teak.localhost:1355");
    expect(origins).toContain("http://localhost:1420");
    expect(origins).toContain("exp+teak://*");
    expect(origins).toContain(EXACT_TEAK_CALLBACK_URL);
    expect(origins).not.toContain("teak://*");
  });
});
