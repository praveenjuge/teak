import { describe, expect, test } from "bun:test";
import {
  classifyDevStorage,
  credentialParityFinding,
  DEVELOPMENT_STORAGE_BUCKET,
  isBlockingFinding,
  isDevelopmentFilesOrigin,
  PRODUCTION_FILES_BASE,
  PRODUCTION_STORAGE_BUCKET,
  parseScopeArg,
} from "./check-cloudflare.ts";

describe("parseScopeArg", () => {
  test("null without the flag", () => {
    expect(parseScopeArg([])).toBeNull();
  });

  test("parses prod and dev scopes", () => {
    expect(parseScopeArg(["--only", "prod"])).toBe("prod");
    expect(parseScopeArg(["--only", "dev"])).toBe("dev");
  });

  test("rejects unknown scopes", () => {
    expect(() => parseScopeArg(["--only", "staging"])).toThrow();
    expect(() => parseScopeArg(["--only"])).toThrow();
  });
});

describe("isBlockingFinding", () => {
  test("missing and different block by default", () => {
    expect(isBlockingFinding("missing")).toBe(true);
    expect(isBlockingFinding("different")).toBe(true);
  });

  test("ok, same, and warn never block by default", () => {
    expect(isBlockingFinding("ok")).toBe(false);
    expect(isBlockingFinding("warn")).toBe(false);
  });

  test("explicit override wins either way", () => {
    expect(isBlockingFinding("missing", { blocking: false })).toBe(false);
    expect(isBlockingFinding("warn", { blocking: true })).toBe(true);
  });
});

const DEV_ORIGIN = "https://teak-files-development.praveenjuge.workers.dev";
const shared = {
  bucket: PRODUCTION_STORAGE_BUCKET,
  prefix: "dev/",
  filesBase: PRODUCTION_FILES_BASE,
};
const isolated = {
  bucket: DEVELOPMENT_STORAGE_BUCKET,
  prefix: "dev/",
  filesBase: DEV_ORIGIN,
};

describe("classifyDevStorage", () => {
  test("accepts today's shared production routing as the current state", () => {
    expect(classifyDevStorage(shared)).toBe("shared");
  });

  test("accepts the dedicated development Worker and bucket as the target", () => {
    expect(classifyDevStorage(isolated)).toBe("isolated");
  });

  test.each([
    { bucket: DEVELOPMENT_STORAGE_BUCKET },
    { filesBase: DEV_ORIGIN },
    { bucket: "teak-files-dev" },
    { prefix: undefined },
    { prefix: "" },
    { bucket: undefined },
  ])("blocks a partial switch or unknown routing: %j", (change) => {
    expect(classifyDevStorage({ ...shared, ...change })).toBe("invalid");
  });

  test("isolated routing still requires the dev/ prefix", () => {
    expect(classifyDevStorage({ ...isolated, prefix: undefined })).toBe(
      "invalid"
    );
  });
});

describe("isDevelopmentFilesOrigin", () => {
  test.each([
    `${DEV_ORIGIN}/`,
    `${DEV_ORIGIN}/path`,
    `${DEV_ORIGIN}?x=1`,
    `${DEV_ORIGIN}:8443`,
    "http://teak-files-development.praveenjuge.workers.dev",
    "https://user:pass@teak-files-development.praveenjuge.workers.dev",
    "https://teak-files-development.praveenjuge.workers.dev.evil.test",
    "https://other.teak.workers.dev",
    "https://teak-files-development.other-account.workers.dev",
    "https://other.praveenjuge.workers.dev",
    PRODUCTION_FILES_BASE,
    "not a url",
    undefined,
  ])("rejects %s", (value) => {
    expect(isDevelopmentFilesOrigin(value)).toBe(false);
  });
});

describe("credentialParityFinding", () => {
  test.each([
    "FILES_SIGNING_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ])(
    "shared routing requires the same %s and isolated routing forbids it",
    (name) => {
      expect(isBlockingFinding("same")).toBe(false);
      const sharedSame = credentialParityFinding(name, "shared", true);
      expect(isBlockingFinding(sharedSame.status, sharedSame)).toBe(false);
      const sharedDiff = credentialParityFinding(name, "shared", false);
      expect(isBlockingFinding(sharedDiff.status, sharedDiff)).toBe(true);
      const isolatedSame = credentialParityFinding(name, "isolated", true);
      expect(isBlockingFinding(isolatedSame.status, isolatedSame)).toBe(true);
      const isolatedDiff = credentialParityFinding(name, "isolated", false);
      expect(isBlockingFinding(isolatedDiff.status, isolatedDiff)).toBe(false);
    }
  );

  test.each(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "R2_ENDPOINT"])(
    "%s must match production in both states",
    (name) => {
      for (const state of ["shared", "isolated"] as const) {
        const same = credentialParityFinding(name, state, true);
        const different = credentialParityFinding(name, state, false);
        expect(isBlockingFinding(same.status, same)).toBe(false);
        expect(isBlockingFinding(different.status, different)).toBe(true);
      }
    }
  );

  test("unknown dev routing keeps the shared expectations", () => {
    const finding = credentialParityFinding(
      "FILES_SIGNING_SECRET",
      null,
      false
    );
    expect(isBlockingFinding(finding.status, finding)).toBe(true);
  });
});
