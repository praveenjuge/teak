import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildDevCommand,
  DEV_TARGETS,
  describeStatus,
  devMainCommand,
  localStackCommand,
  needsWebEnv,
  parseDevArgs,
  planDevLaunch,
  usesWebStack,
} from "./dev.ts";
import { mainWorktreePorts, slotPorts } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "../..");

describe("parseDevArgs", () => {
  test("defaults to web", () => {
    expect(parseDevArgs([])).toEqual({
      action: "run",
      all: false,
      detach: false,
      headless: false,
      local: false,
      push: false,
      target: "web",
    });
  });

  test("parses --local for the web stack only, without --push", () => {
    expect(parseDevArgs(["--local"]).local).toBe(true);
    expect(parseDevArgs(["--local", "--detach"]).detach).toBe(true);
    expect(() => parseDevArgs(["--local", "--push"])).toThrow("--push");
    expect(() => parseDevArgs(["extension", "--local"])).toThrow("web stack");
    expect(() => parseDevArgs(["--all", "--local"])).toThrow("web stack");
  });

  test("parses --push, --status and --stop for the web stack", () => {
    expect(parseDevArgs(["--push"]).push).toBe(true);
    expect(parseDevArgs(["--status"]).action).toBe("status");
    expect(parseDevArgs(["--stop"]).action).toBe("stop");
    expect(() => parseDevArgs(["extension", "--push"])).toThrow("web stack");
    expect(parseDevArgs(["--detach"]).detach).toBe(true);
    expect(parseDevArgs(["--detach", "--push"]).push).toBe(true);
    expect(() => parseDevArgs(["extension", "--detach"])).toThrow("web stack");
    expect(() => parseDevArgs(["--all", "--detach"])).toThrow("web stack");
    expect(() => parseDevArgs(["--workos", "staging"])).toThrow(
      "Unknown dev target"
    );
  });

  test("only the web target runs the local stack", () => {
    expect(usesWebStack(parseDevArgs([]))).toBe(true);
    expect(usesWebStack(parseDevArgs(["web"]))).toBe(true);
    expect(usesWebStack(parseDevArgs(["--all"]))).toBe(false);
    expect(usesWebStack(parseDevArgs(["extension"]))).toBe(false);
  });

  test("parses --headless and matrix aliases", () => {
    expect(parseDevArgs(["web", "--headless"]).headless).toBe(true);
    expect(parseDevArgs(["core-worker"]).target).toBe("core");
  });

  test("parses a single target", () => {
    expect(parseDevArgs(["extension"]).target).toBe("extension");
  });

  test("parses --all and --check", () => {
    expect(parseDevArgs(["--all"]).all).toBe(true);
    expect(parseDevArgs(["--check", "web"]).action).toBe("check");
  });

  test("rejects unknown targets", () => {
    expect(() => parseDevArgs(["unknown-surface"])).toThrow();
  });

  test("rejects unknown flags", () => {
    expect(() => parseDevArgs(["--typo", "extension"])).toThrow();
  });

  test("rejects multiple targets", () => {
    expect(() => parseDevArgs(["docs", "extension"])).toThrow();
  });
});

describe("buildDevCommand", () => {
  test("web maps to web + convex filters", () => {
    expect(buildDevCommand("web")).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=tui",
      "--filter",
      "@teak/web",
      "--filter",
      "@teak/convex",
    ]);
  });

  test("--all starts every surface", () => {
    expect(buildDevCommand("web", { all: true })).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=tui",
    ]);
  });

  test("headless streams task output as it arrives", () => {
    expect(buildDevCommand("web", { headless: true })).toEqual([
      "turbo",
      "watch",
      "dev",
      "--ui=stream",
      "--log-order=stream",
      "--filter",
      "@teak/web",
      "--filter",
      "@teak/convex",
    ]);
  });

  test("files targets use workspace filter", () => {
    expect(buildDevCommand("core")).toEqual([
      "bun",
      "run",
      "--filter",
      "@teak/core-worker",
      "dev",
    ]);
  });

  test("every documented target has filters", () => {
    for (const target of Object.keys(DEV_TARGETS)) {
      expect(buildDevCommand(target)[0]).toBe("turbo");
    }
  });
});

describe("dev target filters", () => {
  const manifests = new Map<string, string>();
  for (const dir of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, dir), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifest = join(ROOT, dir, entry.name, "package.json");
      if (!existsSync(manifest)) {
        continue;
      }
      const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
        name?: string;
      };
      if (pkg.name) {
        manifests.set(pkg.name, manifest);
      }
    }
  }

  const manifestFor = (filter: string): string => {
    if (filter.startsWith(".")) {
      return join(ROOT, filter, "package.json");
    }
    const manifest = manifests.get(filter);
    if (!manifest) {
      throw new Error(`No workspace found for dev filter "${filter}"`);
    }
    return manifest;
  };

  test("every dev target filter has a dev script", () => {
    for (const [target, filters] of Object.entries(DEV_TARGETS)) {
      for (const filter of filters) {
        const manifest = manifestFor(filter);
        expect(existsSync(manifest)).toBe(true);
        const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
          scripts?: Record<string, string>;
        };
        expect(
          pkg.scripts?.dev,
          `${target} filter ${filter} must have a dev script`
        ).toBeDefined();
      }
    }
  });

  test("files targets use scripts the worker defines", () => {
    const manifest = manifestFor("@teak/core-worker");
    const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.dev).toBeDefined();
    expect(pkg.scripts?.["dev:local"]).toBeDefined();
  });
});

describe("needsWebEnv", () => {
  test("web and --all need web env", () => {
    expect(needsWebEnv("web")).toBe(true);
    expect(needsWebEnv("convex", true)).toBe(true);
  });

  test("extension and convex do not need web env", () => {
    expect(needsWebEnv("extension")).toBe(false);
    expect(needsWebEnv("convex")).toBe(false);
  });
});

describe("describeStatus", () => {
  test("tells an agent how to start a stopped stack", () => {
    const text = describeStatus(slotPorts(2), null);
    expect(text).toContain("wt-2");
    expect(text).toContain("bun run dev");
    expect(text).toContain("web 4200");
    expect(text).toContain("shared dev deployment");
  });

  test("points at a running dev stack and its sign-in", () => {
    const text = describeStatus(mainWorktreePorts(), {
      account: { email: "dev+mac-main@example.org", password: "pw-123" },
      groups: [41],
      mode: "dev",
      notes: [
        "main (~/teak on mac) pushes the backend. This checkout runs the web app only; `bun run dev --push` pushes its backend instead.",
        "Sign in as dev+mac-main@example.org / pw-123 (WorkOS staging); its vault already has cards.",
      ],
      pushing: false,
      ready: true,
      logPath: "/tmp/stack.log",
      pid: 42,
      ports: { web: 3000, convex: 3210, convexSite: 3211, emulator: 4100 },
      startedAt: "2026-10-09T00:00:00.000Z",
      urls: {
        appOrigin: "http://localhost:3000",
        apiOrigin: "https://dev-example.convex.site",
        convexUrl: "https://dev-example.convex.cloud",
      },
    });
    expect(text).toContain("Running at http://localhost:3000 (pid 42)");
    expect(text).toContain("bun run dev --stop");
    expect(text).toContain("dev+mac-main@example.org");
    expect(text).toContain("bun run dev --push");
  });

  test("tells a local dev stack apart from an E2E run", () => {
    const state = {
      groups: [41],
      mode: "e2e" as const,
      ready: true,
      logPath: "/tmp/stack.log",
      pid: 42,
      ports: { web: 3000, convex: 3210, convexSite: 3211, emulator: 4100 },
      startedAt: "2026-10-25T00:00:00.000Z",
      urls: {
        appOrigin: "http://localhost:3000",
        apiOrigin: "http://localhost:3211",
        convexUrl: "http://127.0.0.1:3210",
      },
    };
    const run = describeStatus(mainWorktreePorts(), state);
    expect(run).toContain("An E2E run is using this checkout's ports");
    const starting = describeStatus(mainWorktreePorts(), {
      ...state,
      local: true,
      ready: false,
    });
    expect(starting).toContain("on a local backend (bun run dev --local)");
    expect(starting).toContain("Starting at http://localhost:3000 (pid 42)");
    const local = describeStatus(mainWorktreePorts(), {
      ...state,
      local: true,
      account: { email: "dev+local-main@example.org", password: "pw-123" },
      notes: [
        "Sign in as dev+local-main@example.org / pw-123 (WorkOS emulator); its vault is seeded with sample cards.",
      ],
    });
    expect(local).toContain("on a local backend (bun run dev --local)");
    expect(local).toContain("Running at http://localhost:3000 (pid 42)");
    expect(local).toContain("dev+local-main@example.org");
    expect(local).toContain("The backend is http://127.0.0.1:3210");
    expect(local).not.toContain("shared dev deployment");
  });
});

describe("planDevLaunch", () => {
  test.each([
    { argv: ["--help"], hasNodeModules: false, launch: { kind: "help" } },
    { argv: ["--status"], hasNodeModules: false, launch: { kind: "status" } },
    { argv: ["--stop"], hasNodeModules: false, launch: { kind: "stop" } },
    { argv: ["--check"], hasNodeModules: false, launch: { kind: "check" } },
    {
      argv: [],
      hasNodeModules: true,
      launch: { install: false, kind: "main", setup: true },
    },
    {
      argv: ["--push"],
      hasNodeModules: false,
      launch: { install: true, kind: "main", setup: true },
    },
    {
      argv: ["--detach"],
      hasNodeModules: false,
      launch: { install: true, kind: "detach" },
    },
    {
      argv: ["--local"],
      hasNodeModules: true,
      launch: { detach: false, install: false, kind: "local" },
    },
    {
      argv: ["--local", "--detach"],
      hasNodeModules: false,
      launch: { detach: true, install: true, kind: "local" },
    },
    {
      argv: ["extension"],
      hasNodeModules: false,
      launch: { install: true, kind: "main", setup: false },
    },
    {
      argv: ["--all", "--headless"],
      hasNodeModules: true,
      launch: { install: false, kind: "main", setup: false },
    },
  ])(
    "$argv with node_modules=$hasNodeModules",
    ({ argv, hasNodeModules, launch }) => {
      expect(planDevLaunch(parseDevArgs([...argv]), hasNodeModules)).toEqual(
        launch as ReturnType<typeof planDevLaunch>
      );
    }
  );

  test("hands the same arguments to dev-main without loading .env files", () => {
    const command = devMainCommand(["extension", "--headless"]);
    expect(command[0]).toBe(process.execPath);
    expect(command.slice(1)).toEqual([
      "--no-env-file",
      join(ROOT, "scripts/dev/dev-main.ts"),
      "extension",
      "--headless",
    ]);
  });
});

test("--local runs the E2E suite's stack in dev mode, without .env files", () => {
  expect(localStackCommand()).toEqual([
    process.execPath,
    "--no-env-file",
    join(ROOT, "packages/tests/src/scripts/run-local-suite.ts"),
    "stack",
    "--dev",
  ]);
  expect(
    existsSync(join(ROOT, "packages/tests/src/scripts/run-local-suite.ts"))
  ).toBe(true);
});

describe("dev.ts before install", () => {
  const packageImports = (entry: string): string[] => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const seen = new Set<string>();
    const found = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      const source = readFileSync(file, "utf-8").replace(/^#!.*\n/, "");
      for (const { path } of transpiler.scanImports(source)) {
        if (path.startsWith(".")) {
          const base = join(dirname(file), path);
          const resolved = [base, `${base}.ts`, `${base}.tsx`].find(
            (candidate) => existsSync(candidate) && candidate.includes(".ts")
          );
          visit(resolved ?? base);
        } else if (!/^(node|bun):|^bun$/.test(path)) {
          found.add(`${path} (from ${file.replace(`${ROOT}/`, "")})`);
        }
      }
    };
    visit(entry);
    return [...found];
  };

  test("imports no installed package, so it can install them first", () => {
    expect(packageImports(join(ROOT, "scripts/dev/dev.ts"))).toEqual([]);
  });

  test("dev-main loads the installed packages that run the app", () => {
    expect(
      packageImports(join(ROOT, "scripts/dev/dev-main.ts")).some((entry) =>
        entry.startsWith("@workos-inc/node ")
      )
    ).toBe(true);
  });

  test("--help works on its own", () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--no-env-file",
        join(ROOT, "scripts/dev/dev.ts"),
        "--help",
      ],
      { cwd: ROOT }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: bun run dev");
    expect(result.stdout.toString()).toContain("core:local");
  });
});
