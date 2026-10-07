import { describe, expect, test } from "bun:test";
import { TEAK_DEV_FILES_ORIGIN as desktopOrigin } from "../apps/desktop/src/main/contentSecurityPolicy";
import config from "../apps/files-worker/development/wrangler.jsonc";
import { TEAK_DEV_FILES_ORIGIN as webOrigin } from "../apps/web/src/lib/security-headers";
import { TEAK_FILES_HOSTS } from "../packages/ui/src/components/cards/previews/mediaRecovery";
import { DEVELOPMENT_FILES_ORIGIN } from "./check-cloudflare";
import {
  assertDevelopmentWorkerConfig,
  assertIsolatedDevelopmentFiles,
  CONVEX_SELECTOR_VARIABLES,
  type RunCommand,
  readDevelopmentFilesRouting,
} from "./files-worker-dev-boundary";
import { parseSyncArgs } from "./sync-files-worker-dev-secret";

const isolated = {
  bucket: "teak-files-development-20261006",
  prefix: "dev/",
  filesBase: "https://teak-files-development.praveenjuge.workers.dev",
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
        "https://user:secret-value@teak-files-development.praveenjuge.workers.dev",
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

describe("readDevelopmentFilesRouting", () => {
  // Every selector that can outrank --deployment-name, as a shell, CI or a
  // loaded packages/convex/.env.local would supply it.
  const ambient = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/dev",
    CONVEX_DEPLOYMENT: "prod:uncommon-ladybug-882",
    CONVEX_DEPLOY_KEY: "prod:ambient-deploy-key",
    CONVEX_DEPLOYMENT_TOKEN: "ambient-deployment-token",
    CONVEX_SELF_HOSTED_URL: "https://self-hosted.example",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "ambient-self-hosted-admin",
    CONVEX_URL: "https://uncommon-ladybug-882.convex.cloud",
    CONVEX_SITE_URL: "https://uncommon-ladybug-882.convex.site",
    NEXT_PUBLIC_CONVEX_URL: "https://uncommon-ladybug-882.convex.cloud",
  };
  const devValues: Record<string, string> = {
    R2_BUCKET: "teak-files-development-20261006",
    R2_KEY_PREFIX: "dev/",
    FILES_BASE: "https://teak-files-development.praveenjuge.workers.dev",
    FILES_SIGNING_SECRET: "isolated-dev-key",
  };
  const recordingRunner = () => {
    const calls: Parameters<RunCommand>[] = [];
    const run: RunCommand = (argv, options) => {
      calls.push([argv, options]);
      const value = devValues[argv[6] ?? ""];
      return Promise.resolve({ exitCode: 0, stdout: `${value}\n`, stderr: "" });
    };
    return { calls, run };
  };

  test("pins the dev deployment by name and blanks every ambient selector", async () => {
    const { calls, run } = recordingRunner();
    const routing = await readDevelopmentFilesRouting("/repo", run, ambient);

    expect(routing).toEqual({
      bucket: devValues.R2_BUCKET,
      prefix: devValues.R2_KEY_PREFIX,
      filesBase: devValues.FILES_BASE,
      signingSecret: devValues.FILES_SIGNING_SECRET,
    });
    expect(calls.map(([argv]) => argv[6]).sort()).toEqual(
      Object.keys(devValues).sort()
    );
    for (const [argv, { cwd, env }] of calls) {
      expect(argv).toEqual([
        process.execPath,
        "--no-env-file",
        "x",
        "convex",
        "env",
        "get",
        argv[6] as string,
        "--deployment-name",
        "reminiscent-kangaroo-59",
      ]);
      expect(cwd).toBe("/repo/packages/convex");
      for (const name of CONVEX_SELECTOR_VARIABLES) {
        // Present but empty: the Convex CLI's own dotenv loading must not
        // refill a deleted key from packages/convex/.env.local.
        expect(Object.hasOwn(env, name)).toBe(true);
        expect(env[name]).toBe("");
      }
      expect(env.PATH).toBe(ambient.PATH);
      expect(env.HOME).toBe(ambient.HOME);
      const serialized = JSON.stringify(env);
      for (const leaked of [
        "uncommon-ladybug-882",
        "ambient-deploy-key",
        "ambient-deployment-token",
        "self-hosted.example",
        "ambient-self-hosted-admin",
      ]) {
        expect(serialized).not.toContain(leaked);
      }
    }
    expect(ambient.CONVEX_DEPLOY_KEY).toBe("prod:ambient-deploy-key");
  });

  test("reports an unreadable deployment without echoing CLI output", async () => {
    const run: RunCommand = () =>
      Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "private-cli-detail",
      });
    await expect(
      readDevelopmentFilesRouting("/repo", run, ambient)
    ).rejects.toThrow(
      /^Cannot read Convex dev [A-Z0-9_]+; nothing was changed\.$/
    );
  });

  test("treats a missing variable as unset", async () => {
    const run: RunCommand = (argv) =>
      Promise.resolve(
        argv[6] === "FILES_BASE"
          ? {
              exitCode: 1,
              stdout: "",
              stderr: 'Environment variable "FILES_BASE" not found',
            }
          : { exitCode: 0, stdout: `${devValues[argv[6] ?? ""]}\n`, stderr: "" }
      );
    const routing = await readDevelopmentFilesRouting("/repo", run, ambient);
    expect(routing.filesBase).toBeUndefined();
    expect(() => assertIsolatedDevelopmentFiles(routing)).toThrow(
      "neither the shared nor the isolated"
    );
  });
});

test("every client trusts exactly the canonical development Files origin", () => {
  expect(webOrigin).toBe(DEVELOPMENT_FILES_ORIGIN);
  expect(desktopOrigin).toBe(DEVELOPMENT_FILES_ORIGIN);
  expect([...TEAK_FILES_HOSTS].sort()).toEqual(
    ["files.teakvault.com", new URL(DEVELOPMENT_FILES_ORIGIN).hostname].sort()
  );
});
