import { describe, expect, test } from "bun:test";
import {
  appendMediaRetryParam,
  canRetryMedia,
  getMediaRenditionFromUrl,
} from "../mediaRecovery";

const signedGridUrl =
  "https://files.teakvault.com/__images/v1/grid/user/card/file.jpg?exp=123&sig=secret";

describe("media recovery", () => {
  test("preserves signed parameters while adding a single retry marker", () => {
    const retried = new URL(appendMediaRetryParam(signedGridUrl));
    expect(retried.searchParams.get("exp")).toBe("123");
    expect(retried.searchParams.get("sig")).toBe("secret");
    expect(retried.searchParams.get("teak_retry")).toBe("1");
  });

  test("only retries Teak media once", () => {
    expect(canRetryMedia(signedGridUrl, 0)).toBe(true);
    expect(canRetryMedia(signedGridUrl, 1)).toBe(false);
    expect(canRetryMedia("https://example.com/image.jpg", 0)).toBe(false);
    expect(canRetryMedia(appendMediaRetryParam(signedGridUrl), 0)).toBe(false);
  });

  test("recognizes only allowlisted image renditions", () => {
    expect(getMediaRenditionFromUrl(signedGridUrl)).toBe("grid");
    expect(
      getMediaRenditionFromUrl(
        "https://files.teakvault.com/__images/v1/arbitrary/key?sig=x"
      )
    ).toBeUndefined();
    expect(
      getMediaRenditionFromUrl("https://example.com/__images/v1/grid/key")
    ).toBeUndefined();
  });
});
