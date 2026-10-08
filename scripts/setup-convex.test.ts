import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandResult } from "./proc.ts";
import {
  convexDevOnce,
  isTransientPushFailure,
  readConvexDotenvUrls,
  summarizePushFailure,
} from "./setup-convex.ts";

describe("readConvexDotenvUrls", () => {
  test("reads convex dotenv urls without requiring them", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const dotenv = join(dir, ".env.local");
    writeFileSync(
      dotenv,
      "CONVEX_DEPLOYMENT=dev:x\nNEXT_PUBLIC_CONVEX_URL=https://c.example\n"
    );
    expect(readConvexDotenvUrls(dotenv)).toEqual({
      convexUrl: "https://c.example",
    });
    expect(readConvexDotenvUrls(join(dir, "absent"))).toEqual({});
  });
});

describe("summarizePushFailure", () => {
  test("keeps the signal line even when it precedes the tail", () => {
    const stderr = [
      "Environment variable WORKOS_CLIENT_ID is used in auth config file but its value was not set.",
      "Go to:",
      "",
      "    https://dashboard.convex.dev/d/acme/settings/environment-variables?var=WORKOS_CLIENT_ID",
      "",
      "  to set it up.",
    ].join("\n");
    const summary = summarizePushFailure(stderr);
    expect(summary).toContain("Environment variable WORKOS_CLIENT_ID");
    expect(summary).toContain("to set it up.");
  });

  test("falls back to the tail when nothing matches", () => {
    expect(summarizePushFailure("a\nb\nc\nd")).toBe("b c d");
  });

  test("reports unknown error for blank output", () => {
    expect(summarizePushFailure("  \n ")).toBe("unknown error");
  });
});

describe("isTransientPushFailure", () => {
  test("matches the local backend journal race from CI", () => {
    expect(
      isTransientPushFailure(
        "Unexpected Error: Error: ENOENT: no such file or directory, stat '/home/runner/work/teak/teak/packages/convex/.convex/local/default/convex_local_backend.sqlite3-journal'"
      )
    ).toBe(true);
  });

  test("matches other local backend startup races", () => {
    expect(
      isTransientPushFailure("Error: SQLITE_BUSY: database is locked")
    ).toBe(true);
    expect(
      isTransientPushFailure("Error: connect ECONNREFUSED 127.0.0.1:3210")
    ).toBe(true);
  });

  test("rejects deterministic configuration failures", () => {
    expect(
      isTransientPushFailure(
        "Failed to analyze auth.js: Uncaught Error: SITE_URL environment variable is required."
      )
    ).toBe(false);
    expect(
      isTransientPushFailure(
        "Environment variable WORKOS_CLIENT_ID is used in auth config file but its value was not set."
      )
    ).toBe(false);
    expect(isTransientPushFailure("")).toBe(false);
  });

  test("rejects deterministic database errors naming the backend file", () => {
    expect(
      isTransientPushFailure(
        "Error: convex_local_backend.sqlite3 database disk image is malformed"
      )
    ).toBe(false);
  });
});

describe("convexDevOnce retry", () => {
  const JOURNAL_STDERR =
    "Unexpected Error: Error: ENOENT: no such file or directory, stat '/home/runner/work/teak/teak/packages/convex/.convex/local/default/convex_local_backend.sqlite3-journal'";
  const SITE_URL_STDERR =
    "Failed to analyze auth.js: Uncaught Error: SITE_URL environment variable is required.";

  interface ScriptedResult {
    exitCode: number;
    stderr: string;
    stdout?: string;
  }

  const makeRunner = (script: ScriptedResult[]) => {
    const calls: string[][] = [];
    const run = (command: string[]): Promise<RunCommandResult> => {
      calls.push(command);
      const next = script[Math.min(calls.length - 1, script.length - 1)];
      return Promise.resolve({
        exitCode: next.exitCode,
        pid: 1,
        stderr: next.stderr,
        stdout: next.stdout ?? "",
        timedOut: false,
      });
    };
    return { calls, run };
  };

  test("retries a transient journal failure until the push succeeds", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
      { exitCode: 0, stderr: "" },
    ]);
    const sleeps: number[] = [];
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ detail: "pushed", ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["bunx", "convex", "dev", "--once"]);
    expect(sleeps).toHaveLength(1);
  });

  test("gives up after exhausting attempts on persistent transient failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ENOENT");
    expect(calls).toHaveLength(3);
  });

  test("does not retry deterministic failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: SITE_URL_STDERR },
    ]);
    const sleeps: number[] = [];
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SITE_URL");
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  test("honors a single attempt even for transient failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      attempts: 1,
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("falls back to the default attempts for nonfinite values", async () => {
    for (const attempts of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { calls, run } = makeRunner([
        { exitCode: 1, stderr: JOURNAL_STDERR },
      ]);
      const result = await convexDevOnce("/tmp/teak-convex", {
        attempts,
        run,
        sleepMs: () => Promise.resolve(),
      });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(3);
    }
  });

  test("preserves transient diagnostics that appear only in stdout", async () => {
    const { calls, run } = makeRunner([
      {
        exitCode: 1,
        stderr: "",
        stdout: "Error: SQLITE_BUSY: database is locked",
      },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SQLITE_BUSY");
    expect(calls).toHaveLength(3);
  });
});

describe("selected anonymous backend shutdown recovery", () => {
  const collision =
    "A local backend is still running on port 3210. Please stop it and run this command again.";
  const withSelection = async (
    deployment: string,
    operation: (cwd: string) => Promise<void>
  ) => {
    const priorMode = process.env.CONVEX_AGENT_MODE;
    const priorSelection = process.env.CONVEX_DEPLOYMENT;
    const priorKey = process.env.CONVEX_DEPLOY_KEY;
    const cwd = mkdtempSync(join(tmpdir(), "teak-local-shutdown-"));
    writeFileSync(join(cwd, ".env.local"), `CONVEX_DEPLOYMENT=${deployment}\n`);
    process.env.CONVEX_AGENT_MODE = "anonymous";
    delete process.env.CONVEX_DEPLOYMENT;
    delete process.env.CONVEX_DEPLOY_KEY;
    try {
      await operation(cwd);
    } finally {
      for (const [key, prior] of [
        ["CONVEX_AGENT_MODE", priorMode],
        ["CONVEX_DEPLOYMENT", priorSelection],
        ["CONVEX_DEPLOY_KEY", priorKey],
      ]) {
        if (prior === undefined) {
          delete process.env[key!];
        } else {
          process.env[key!] = prior;
        }
      }
    }
  };
  const boundary = (name: string) =>
    Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://127.0.0.1:3210/instance_name");
        expect(init?.redirect).toBe("error");
        return Promise.resolve(new Response(name));
      },
      { preconnect: fetch.preconnect }
    );
  test("retries only the matching selected anonymous backend until push succeeds", async () => {
    await withSelection("anonymous:anonymous-agent", async (cwd) => {
      let calls = 0;
      const sleeps: number[] = [];
      const result = await convexDevOnce(cwd, {
        run: async () => ({
          exitCode: ++calls === 1 ? 1 : 0,
          stderr: calls === 1 ? collision : "",
          stdout: "",
          timedOut: false,
          pid: 1,
        }),
        fetch: boundary("anonymous-agent"),
        sleepMs: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
      expect(sleeps).toEqual([2000]);
    });
  });
  test.each([
    { name: "file-based anonymous mode", fileMode: "anonymous", retry: true },
    {
      name: "blank shell mode falls back to anonymous file",
      fileMode: "anonymous",
      shellMode: "  ",
      retry: true,
    },
    {
      name: "blank shell key does not bypass file deploy key",
      fileMode: "anonymous",
      shellMode: "anonymous",
      fileKey: "test-only-key",
      shellKey: "  ",
      retry: false,
    },
    {
      name: "shell anonymous overrides file mode",
      fileMode: "disabled",
      shellMode: "anonymous",
      retry: true,
    },
    {
      name: "shell mode overrides file anonymous",
      fileMode: "anonymous",
      shellMode: "disabled",
      retry: false,
    },
    {
      name: "file deploy key blocks local probing",
      fileMode: "anonymous",
      fileKey: "test-only-key",
      retry: false,
    },
    {
      name: "file deploy key blocks shell anonymous",
      fileMode: "anonymous",
      shellMode: "anonymous",
      fileKey: "test-only-key",
      retry: false,
    },
    {
      name: "shell deploy key overrides empty file key",
      fileMode: "anonymous",
      fileKey: "",
      shellKey: "test-only-key",
      retry: false,
    },
    {
      name: "shell selection overrides anonymous file",
      fileMode: "anonymous",
      shellSelection: "dev:other",
      retry: false,
    },
  ])("uses declared authority for $name", async (authority) => {
    await withSelection("anonymous:anonymous-agent", async (cwd) => {
      writeFileSync(
        join(cwd, ".env.local"),
        `CONVEX_DEPLOYMENT=anonymous:anonymous-agent\nCONVEX_AGENT_MODE=${authority.fileMode}\nCONVEX_DEPLOY_KEY=${authority.fileKey ?? ""}\n`
      );
      if (authority.shellMode === undefined) {
        delete process.env.CONVEX_AGENT_MODE;
      } else {
        process.env.CONVEX_AGENT_MODE = authority.shellMode;
      }
      if (authority.shellKey !== undefined) {
        process.env.CONVEX_DEPLOY_KEY = authority.shellKey;
      }
      if (authority.shellSelection !== undefined) {
        process.env.CONVEX_DEPLOYMENT = authority.shellSelection;
      }
      let calls = 0;
      let probes = 0;
      const sleeps: number[] = [];
      const result = await convexDevOnce(cwd, {
        run: async () => ({
          exitCode: ++calls === 1 ? 1 : 0,
          stderr: calls === 1 ? collision : "",
          stdout: "",
          timedOut: false,
          pid: 1,
        }),
        fetch: Object.assign(
          () => {
            probes++;
            return Promise.resolve(new Response("anonymous-agent"));
          },
          { preconnect: fetch.preconnect }
        ),
        sleepMs: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      expect(result.ok).toBe(authority.retry);
      expect(calls).toBe(authority.retry ? 2 : 1);
      expect(probes).toBe(authority.retry ? 1 : 0);
      expect(sleeps).toEqual(authority.retry ? [2000] : []);
    });
  });
  test.each(["other-project", "<html>unrelated service</html>"])(
    "refuses unrelated occupied process %s",
    async (instance) => {
      await withSelection("anonymous:anonymous-agent", async (cwd) => {
        let calls = 0;
        const result = await convexDevOnce(cwd, {
          run: async () => ({
            exitCode: 1,
            stderr: collision,
            stdout: "",
            timedOut: false,
            pid: ++calls,
          }),
          fetch: boundary(instance),
          sleepMs: () => {
            throw new Error("Unexpected retry");
          },
        });
        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
      });
    }
  );
  test.each(["prod:anonymous-agent", "dev:anonymous-agent"])(
    "refuses nonlocal selection %s",
    async (selection) => {
      await withSelection(selection, async (cwd) => {
        let calls = 0;
        let probes = 0;
        const result = await convexDevOnce(cwd, {
          run: async () => ({
            exitCode: 1,
            stderr: collision,
            stdout: "",
            timedOut: false,
            pid: ++calls,
          }),
          fetch: Object.assign(
            () => {
              probes++;
              throw new Error("Unexpected local probe");
            },
            { preconnect: fetch.preconnect }
          ),
          sleepMs: () => {
            throw new Error("Unexpected retry");
          },
        });
        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
        expect(probes).toBe(0);
      });
    }
  );
  test.each(["other-port", "no-agent-mode", "deploy-key", "unselected"])(
    "refuses shutdown recovery with %s authority",
    async (failure) => {
      await withSelection("anonymous:anonymous-agent", async (cwd) => {
        let calls = 0;
        let probes = 0;
        if (failure === "no-agent-mode") {
          delete process.env.CONVEX_AGENT_MODE;
        }
        if (failure === "deploy-key") {
          process.env.CONVEX_DEPLOY_KEY = "test-only-blocked-key";
        }
        if (failure === "unselected") {
          process.env.CONVEX_DEPLOYMENT = "unselected";
        }
        const result = await convexDevOnce(cwd, {
          run: async () => ({
            exitCode: 1,
            stderr:
              failure === "other-port"
                ? collision.replace("3210", "9999")
                : collision,
            stdout: "",
            timedOut: false,
            pid: ++calls,
          }),
          fetch: Object.assign(
            () => {
              probes++;
              return Promise.resolve(new Response("anonymous-agent"));
            },
            { preconnect: fetch.preconnect }
          ),
          sleepMs: () => {
            throw new Error("Unexpected retry");
          },
        });
        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
        expect(probes).toBe(0);
      });
    }
  );
  test.each(["unreachable", "status", "oversized"])(
    "refuses an uncertain %s instance response",
    async (failure) => {
      await withSelection("anonymous:anonymous-agent", async (cwd) => {
        let calls = 0;
        let probes = 0;
        const result = await convexDevOnce(cwd, {
          run: async () => ({
            exitCode: 1,
            stderr: collision,
            stdout: "",
            timedOut: false,
            pid: ++calls,
          }),
          fetch: Object.assign(
            () => {
              probes++;
              if (failure === "unreachable") {
                return Promise.reject(new Error("connection refused"));
              }
              return Promise.resolve(
                new Response(
                  failure === "oversized" ? "x".repeat(129) : "anonymous-agent",
                  { status: failure === "status" ? 503 : 200 }
                )
              );
            },
            { preconnect: fetch.preconnect }
          ),
          sleepMs: () => {
            throw new Error("Unexpected retry");
          },
        });
        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
        expect(probes).toBe(1);
      });
    }
  );
  test("persistent matching shutdown collisions stop after three attempts", async () => {
    await withSelection("anonymous:anonymous-agent", async (cwd) => {
      let calls = 0;
      const sleeps: number[] = [];
      const result = await convexDevOnce(cwd, {
        run: async () => ({
          exitCode: 1,
          stderr: collision,
          stdout: "",
          timedOut: false,
          pid: ++calls,
        }),
        fetch: boundary("anonymous-agent"),
        sleepMs: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      expect(result.ok).toBe(false);
      expect(calls).toBe(3);
      expect(sleeps).toEqual([2000, 4000]);
    });
  });
});
