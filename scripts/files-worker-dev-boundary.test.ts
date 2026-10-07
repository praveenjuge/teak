import { describe, expect, test } from "bun:test";
import config from "../apps/files-worker/development/wrangler.jsonc";
import {
  assertDevelopmentWorkerConfig,
  assertIsolatedDevelopmentFiles,
} from "./files-worker-dev-boundary";
import { parseSyncArgs } from "./sync-files-worker-dev-secret";

const isolated = {
  bucket: "teak-files-development-20261006",
  prefix: "dev/",
  filesBase: "https://teak-files-development.teak.workers.dev",
  signingSecret: "isolated-dev-key",
};

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("assertIsolatedDevelopmentFiles", () => {
  test("returns the dev key once Convex dev uses the isolated Worker", () => {
    expect(assertIsolatedDevelopmentFiles(isolated)).toBe("isolated-dev-key");
  });

  test("refuses today's shared routing without treating it as broken", () => {
    const message = messageOf(() =>
      assertIsolatedDevelopmentFiles({
        ...isolated,
        bucket: "teak-files-prod",
        filesBase: "https://files.teakvault.com",
        signingSecret: "shared-production-key",
      })
    );
    expect(message).toContain("after the approved storage switch");
    expect(message).not.toContain("shared-production-key");
  });

  test.each([
    { bucket: "teak-files-prod" },
    { filesBase: "https://files.teakvault.com" },
    { prefix: undefined },
    {
      filesBase:
        "https://user:secret-value@teak-files-development.teak.workers.dev",
    },
  ])(
    "refuses a partial or unsafe switch without echoing values: %j",
    (change) => {
      const message = messageOf(() =>
        assertIsolatedDevelopmentFiles({ ...isolated, ...change })
      );
      expect(message).toContain("neither the shared nor the isolated");
      expect(message).not.toContain("secret-value");
    }
  );

  test.each([
    undefined,
    "",
    "bad key",
    "bad\nkey",
    "bad#key",
    "bad$key",
    'bad"key',
  ])("refuses a missing or dotenv-unsafe key: %j", (signingSecret) => {
    expect(() =>
      assertIsolatedDevelopmentFiles({ ...isolated, signingSecret })
    ).toThrow("FILES_SIGNING_SECRET is missing or not a safe dotenv value");
  });
});

describe("assertDevelopmentWorkerConfig", () => {
  test("accepts the committed development config", () => {
    expect(() => assertDevelopmentWorkerConfig(config)).not.toThrow();
  });

  test.each([
    { name: "teak-files-proxy" },
    { account_id: "another-account" },
    { routes: [{ pattern: "files.teakvault.com", custom_domain: true }] },
    { r2_buckets: [{ binding: "BUCKET", bucket_name: "teak-files-prod" }] },
    {
      r2_buckets: [
        {
          binding: "BUCKET",
          bucket_name: "teak-files-development-20261006",
          preview_bucket_name: "teak-files-prod",
        },
      ],
    },
    {
      r2_buckets: [
        ...config.r2_buckets,
        { binding: "PROD", bucket_name: "teak-files-prod" },
      ],
    },
    {
      durable_objects: {
        bindings: [
          {
            name: "OBJECT_GATES",
            class_name: "ObjectDeletionGate",
            script_name: "teak-files-proxy",
          },
        ],
      },
    },
  ])("refuses production routing, storage or gates: %j", (change) => {
    expect(() =>
      assertDevelopmentWorkerConfig({ ...config, ...change })
    ).toThrow();
  });
});

describe("parseSyncArgs", () => {
  test("defaults to today's shared Worker file", () => {
    expect(parseSyncArgs([])).toEqual({ isolated: false });
  });

  test("selects the isolated Worker only when asked", () => {
    expect(parseSyncArgs(["--isolated"])).toEqual({ isolated: true });
    expect(parseSyncArgs(["--", "--isolated"])).toEqual({ isolated: true });
  });

  test("rejects anything else", () => {
    expect(() => parseSyncArgs(["--prod"])).toThrow("Usage");
    expect(() => parseSyncArgs(["--isolated", "--prod"])).toThrow("Usage");
  });
});
