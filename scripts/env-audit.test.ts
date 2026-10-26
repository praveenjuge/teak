import { describe, expect, test } from "bun:test";
import {
  auditFiles,
  extractCodeUses,
  extractShellUses,
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

  test("workflow vars-with-secrets fallbacks resolve both sides", () => {
    const { secrets, vars } = extractWorkflowRefs(
      `a: $${"{{ vars.PUBLIC_URL || secrets.PUBLIC_URL }}"}`
    );
    expect(secrets).toEqual([{ name: "PUBLIC_URL", line: 1 }]);
    expect(vars).toEqual([{ name: "PUBLIC_URL", line: 1 }]);
  });

  test("workflow env block keys are collected", () => {
    const keys = extractWorkflowEnvKeys(
      "  env:\n    FOO: bar\n    BAZ_QUX: 1\n  run: echo"
    );
    expect(keys.map((key) => key.name)).toEqual(["FOO", "BAZ_QUX"]);
  });

  test("top-level workflow env blocks survive blanks and comments", () => {
    const keys = extractWorkflowEnvKeys(
      [
        "env:",
        "  FOO: bar",
        "",
        "  # comment",
        "  BAZ_QUX: 1",
        "jobs:",
        "  build:",
        "    env: # trailing comment",
        "      NESTED_ONE: x",
        "",
        "      NESTED_TWO: y",
        "    runs-on: ubuntu-latest",
      ].join("\n")
    );
    expect(keys.map((key) => key.name)).toEqual([
      "FOO",
      "BAZ_QUX",
      "NESTED_ONE",
      "NESTED_TWO",
    ]);
  });

  test("ruby bracket and fetch reads resolve with lines", () => {
    const uses = extractCodeUses(
      "token = ENV[\"API_KEY\"]\nsecret = ENV.fetch('OTHER_SECRET')"
    );
    expect(uses).toEqual([
      { name: "API_KEY", line: 1 },
      { name: "OTHER_SECRET", line: 2 },
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
      "console.log(`token ${process.env.WORKOS_WEBHOOK_SECRET}`);"
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].kind).toBe("secret-in-diagnostics");
    const clean = findSecretDiagnostics(
      "scripts/doctor.ts",
      "const present = Boolean(process.env.WORKOS_WEBHOOK_SECRET);\nconsole.log('checked');"
    );
    expect(clean).toHaveLength(0);
  });

  test("secret diagnostics flag aliased secrets", () => {
    const flagged = findSecretDiagnostics(
      "scripts/doctor.ts",
      "const token = process.env.WORKOS_WEBHOOK_SECRET;\nconsole.log(token);"
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      kind: "secret-in-diagnostics",
      name: "WORKOS_WEBHOOK_SECRET",
    });
    const unlogged = findSecretDiagnostics(
      "scripts/doctor.ts",
      "const token = process.env.WORKOS_WEBHOOK_SECRET;\nconsole.log('checked');"
    );
    expect(unlogged).toHaveLength(0);
  });

  test("secret diagnostics flag platform credentials and typed reads", () => {
    const platform = findSecretDiagnostics(
      "scripts/doctor.ts",
      "console.log(process.env.GITHUB_TOKEN);"
    );
    expect(platform).toHaveLength(1);
    expect(platform[0].name).toBe("GITHUB_TOKEN");
    const typed = findSecretDiagnostics(
      "scripts/doctor.ts",
      "console.log(env.FILES_SIGNING_SECRET);"
    );
    expect(typed).toHaveLength(1);
    expect(typed[0].name).toBe("FILES_SIGNING_SECRET");
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

  test("package.json scripts count as references", () => {
    const findings = auditFiles(
      new Map([
        [
          "apps/docs/package.json",
          JSON.stringify({
            scripts: { dev: "serve --port $DOCS_PORT" },
          }),
        ],
      ])
    );
    expect(
      findings.some(
        (finding) => finding.kind === "stale" && finding.name === "DOCS_PORT"
      )
    ).toBe(false);
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

  test("direct alias reads fail outside accessors", () => {
    const findings = auditFiles(
      new Map([
        [
          "apps/web/src/a.ts",
          "const url = process.env.NEXT_PUBLIC_CONVEX_URL;\n",
        ],
      ])
    );
    expect(
      findings.some(
        (finding) =>
          finding.kind === "direct-alias-read" &&
          finding.name === "NEXT_PUBLIC_CONVEX_URL"
      )
    ).toBe(true);
  });

  test("accessors, tests, and the e2e harness may touch aliases", () => {
    const findings = auditFiles(
      new Map([
        [
          "apps/web/src/lib/public-env.ts",
          "const url = process.env.NEXT_PUBLIC_CONVEX_URL;\n",
        ],
        [
          "apps/extension/lib/env.ts",
          "const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;\n",
        ],
        [
          "apps/web/src/tests/setup.ts",
          "const url = process.env.NEXT_PUBLIC_CONVEX_URL;\n",
        ],
        [
          "packages/tests/src/harness.ts",
          "const url = process.env.NEXT_PUBLIC_CONVEX_URL;\n",
        ],
      ])
    );
    expect(
      findings.filter((finding) => finding.kind === "direct-alias-read")
    ).toHaveLength(0);
  });
});
