import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_TEAK_DEV_CONVEX_URL } from "@teak/convex/devUrls";
import { filesOrigin } from "../public-env";

const previous = {
  convex: process.env.NEXT_PUBLIC_CONVEX_URL,
  files: process.env.NEXT_PUBLIC_FILES_BASE,
};

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(() => {
  restore("NEXT_PUBLIC_CONVEX_URL", previous.convex);
  restore("NEXT_PUBLIC_FILES_BASE", previous.files);
});

describe("the files origin the page connects to early", () => {
  test.each([
    [
      "a self-hosted files host",
      "https://backend.example",
      " https://files.example.com/worker ",
      "https://files.example.com",
    ],
    [
      "the development Core Worker for the development deployment",
      DEFAULT_TEAK_DEV_CONVEX_URL,
      undefined,
      "https://core-worker-dev.praveenjuge.workers.dev",
    ],
    [
      "Teak's own files host otherwise",
      "https://other-deployment-1.convex.cloud",
      undefined,
      "https://files.teakvault.com",
    ],
    [
      "Teak's own files host when the configured one isn't https",
      "https://backend.example",
      "http://files.example.com",
      "https://files.teakvault.com",
    ],
  ])("is %s", (_name, convexUrl, filesBase, origin) => {
    restore("NEXT_PUBLIC_CONVEX_URL", convexUrl);
    restore("NEXT_PUBLIC_FILES_BASE", filesBase);
    expect(filesOrigin()).toBe(origin);
  });
});
