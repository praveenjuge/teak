import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditFiles,
  extractShellUses,
  extractTurboDecls,
  extractWorkflowEnvKeys,
  extractWorkflowRefs,
  findSecretDiagnostics,
} from "./env-audit.ts";

describe("env-audit extractors", () => {
  test("workflow secrets and vars references resolve with lines", () => {
    const { secrets, vars } = extractWorkflowRefs(
      `a: $${"{{ secrets.FOO_BAR }}"}\nb: $${"{{ vars.BAZ_QUX }}"}`
    );
    expect(secrets).toEqual([{ name: "FOO_BAR", line: 1 }]);
    expect(vars).toEqual([{ name: "BAZ_QUX", line: 2 }]);
  });

  test("workflow env block keys are collected", () => {
    const keys = extractWorkflowEnvKeys(
      "  env:\n    FOO: bar\n    BAZ_QUX: 1\n  run: echo"
    );
    expect(keys.map((key) => key.name)).toEqual(["FOO", "BAZ_QUX"]);
  });

  test("turbo declarations include env and passThroughEnv", () => {
    const decls = extractTurboDecls(
      JSON.stringify({
        globalEnv: ["A_ONE"],
        tasks: { build: { env: ["B_TWO"], passThroughEnv: ["C_THREE"] } },
      }),
      "turbo.json"
    );
    expect(decls.map((decl) => decl.name).sort()).toEqual([
      "A_ONE",
      "B_TWO",
      "C_THREE",
    ]);
  });

  test("shell uses ignore locals, lowercase, and platform names", () => {
    const uses = extractShellUses(
      `BASE_URL="\${SMOKE_BASE_URL:-\${BASE_URL:-x}}"\nIS_PROD=1\nEXPECTED_BASE="\${EXPECTED_BASE_URL:-}"\nEXPECTED_BASE="\${EXPECTED_BASE%/}"\necho "$BASE_URL $IS_PROD $HOME \${slug} $EXPECTED_BASE"`
    );
    expect(uses.map((use) => use.name).sort()).toEqual([
      "BASE_URL",
      "EXPECTED_BASE_URL",
      "SMOKE_BASE_URL",
    ]);
  });

  test("secret diagnostics flag interpolated secrets only", () => {
    const flagged = findSecretDiagnostics(
      "scripts/doctor.ts",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture intentionally contains interpolation syntax
      "console.log(`token ${process.env.E2E_CLEANUP_TOKEN}`);"
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].kind).toBe("secret-in-diagnostics");
    const clean = findSecretDiagnostics(
      "scripts/doctor.ts",
      "const present = Boolean(process.env.E2E_CLEANUP_TOKEN);\nconsole.log('checked');"
    );
    expect(clean).toHaveLength(0);
  });
});

describe("env-audit auditFiles", () => {
  test("undeclared reads fail with file and line", () => {
    const findings = auditFiles(
      new Map([["apps/web/src/a.ts", "const x = process.env.MADE_UP_VAR;\n"]])
    );
    expect(
      findings.some(
        (finding) =>
          finding.kind === "undeclared" &&
          finding.name === "MADE_UP_VAR" &&
          finding.path === "apps/web/src/a.ts:1"
      )
    ).toBe(true);
  });

  test("deleted aliases fail even when otherwise valid", () => {
    const findings = auditFiles(
      new Map([["packages/convex/a.ts", "process.env.PUBLIC_API_URL\n"]])
    );
    expect(
      findings.some(
        (finding) =>
          finding.kind === "deleted-alias" && finding.name === "PUBLIC_API_URL"
      )
    ).toBe(true);
  });

  test("turbo wildcards fail", () => {
    const findings = auditFiles(
      new Map([
        [
          "turbo.json",
          JSON.stringify({ tasks: { build: { env: ["FOO_*"] } } }),
        ],
      ])
    );
    expect(findings.some((finding) => finding.kind === "turbo-wildcard")).toBe(
      true
    );
  });

  test("platform names pass without contract entries", () => {
    const findings = auditFiles(
      new Map([
        [
          "apps/web/src/a.ts",
          "const a = process.env.CI;\nconst b = process.env.VERCEL_ENV;\n",
        ],
      ])
    );
    expect(
      findings.filter((finding) => finding.kind === "undeclared")
    ).toHaveLength(0);
  });

  test("contract references suppress stale findings", () => {
    const findings = auditFiles(
      new Map([["apps/web/src/a.ts", "process.env.SITE_URL\n"]])
    );
    expect(
      findings.some(
        (finding) => finding.kind === "stale" && finding.name === "SITE_URL"
      )
    ).toBe(false);
  });
});

describe("turbo env scoping", () => {
  const root = join(import.meta.dir, "..");
  const load = (rel: string) =>
    JSON.parse(readFileSync(join(root, rel), "utf-8")) as {
      globalEnv?: string[];
      tasks?: Record<
        string,
        { env?: string[]; inputs?: string[]; passThroughEnv?: string[] }
      >;
    };

  test("root config carries no env declarations or dotenv inputs", () => {
    const config = load("turbo.json");
    expect(config.globalEnv ?? []).not.toContain("SITE_URL");
    for (const task of Object.values(config.tasks ?? {})) {
      expect(task.env ?? []).toEqual([]);
      expect(
        (task.inputs ?? []).filter((input) => input.includes(".env"))
      ).toEqual([]);
    }
  });

  test("convex test tasks own exactly SITE_URL", () => {
    const config = load("packages/convex/turbo.json");
    for (const name of ["test", "test:unit", "test:edge"]) {
      expect(config.tasks?.[name]?.env).toEqual(["SITE_URL"]);
    }
  });

  test("no turbo config declares wildcards", () => {
    const rels = [
      "turbo.json",
      "apps/web/turbo.json",
      "apps/docs/turbo.json",
      "apps/extension/turbo.json",
      "apps/desktop/turbo.json",
      "apps/mobile/turbo.json",
      "packages/convex/turbo.json",
      "packages/ui/turbo.json",
    ];
    for (const rel of rels) {
      if (!existsSync(join(root, rel))) {
        continue;
      }
      for (const decl of extractTurboDecls(
        readFileSync(join(root, rel), "utf-8"),
        rel
      )) {
        expect(decl.name).not.toContain("*");
      }
    }
  });
});
