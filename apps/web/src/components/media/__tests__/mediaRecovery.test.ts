import { describe, expect, test } from "bun:test";
import { DEFAULT_TEAK_DEV_CONVEX_URL } from "@teak/convex/devUrls";
import {
  appendMediaRetryParam,
  canRetryMedia,
  getMediaRenditionFromUrl,
} from "../mediaRecovery";

const withEnv = (
  values: { NEXT_PUBLIC_CONVEX_URL?: string; NEXT_PUBLIC_FILES_BASE?: string },
  run: () => void
) => {
  const names = ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_FILES_BASE"] as const;
  const previous = names.map((name) => process.env[name]);
  for (const name of names) {
    const value = values[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  try {
    run();
  } finally {
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
};

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
    expect(canRetryMedia(signedGridUrl)).toBe(true);
    expect(canRetryMedia("https://example.com/image.jpg")).toBe(false);
    expect(canRetryMedia(appendMediaRetryParam(signedGridUrl))).toBe(false);
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

  test.each([
    [
      "Teak's own files host",
      {},
      "https://files.teakvault.com/__images/v1/grid/user/card/file.jpg?exp=1&sig=x",
    ],
    [
      "the development Core Worker, for the development deployment",
      {
        NEXT_PUBLIC_CONVEX_URL: DEFAULT_TEAK_DEV_CONVEX_URL,
      },
      "https://core-worker-dev.praveenjuge.workers.dev/__images/v1/grid/user/card/file.jpg?exp=1&sig=x",
    ],
    [
      "a self-hosted files host",
      { NEXT_PUBLIC_FILES_BASE: "https://files.example.com" },
      "https://files.example.com/__images/v1/grid/user/card/file.jpg?exp=1&sig=x",
    ],
    [
      "the local stack's Core Worker",
      {
        NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
        NEXT_PUBLIC_FILES_BASE: "http://127.0.0.1:8789",
      },
      "http://127.0.0.1:8789/__images/v1/grid/user/card/file.jpg?exp=1&sig=x",
    ],
  ])("recovers expired media from %s", (_name, env, url) => {
    withEnv(env, () => {
      expect(canRetryMedia(url)).toBe(true);
      expect(getMediaRenditionFromUrl(url)).toBe("grid");
    });
  });

  test("the development Core Worker isn't a files host for other deployments", () => {
    withEnv(
      { NEXT_PUBLIC_CONVEX_URL: "https://other-deployment-1.convex.cloud" },
      () => {
        expect(
          canRetryMedia(
            "https://core-worker-dev.praveenjuge.workers.dev/__images/v1/grid/key?sig=x"
          )
        ).toBe(false);
      }
    );
  });

  test.each([
    "https://other.praveenjuge.workers.dev/__images/v1/grid/key?sig=x",
    "https://core-worker-dev.other.workers.dev/__images/v1/grid/key?sig=x",
    "https://core-worker-dev.praveenjuge.workers.dev.evil.test/__images/v1/grid/key",
    "http://files.teakvault.com/__images/v1/grid/key?sig=x",
    "http://teak-files-development.praveenjuge.workers.dev/__images/v1/grid/key",
  ])("never treats lookalike or insecure origins as Teak media: %s", (url) => {
    expect(canRetryMedia(url)).toBe(false);
    expect(getMediaRenditionFromUrl(url)).toBeUndefined();
  });
});
