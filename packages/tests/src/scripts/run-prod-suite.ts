import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("../../../../", import.meta.url).pathname);
const testsDir = join(repoRoot, "packages/tests");
const reportRoot = join(testsDir, "playwright-report");
const resultsRoot = join(testsDir, "test-results");
const stateRoot = join(testsDir, ".state");
const runnerTemp = process.env.RUNNER_TEMP || join(repoRoot, ".tmp/prod-e2e");

const loadEnvFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!(line && !line.startsWith("#"))) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }
    process.env[key] = rawValue
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
};

for (const filePath of [
  join(repoRoot, ".env.production-e2e.local"),
  join(testsDir, ".env.production-e2e.local"),
]) {
  loadEnvFile(filePath);
}

if (!process.env.VITE_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CONVEX_URL) {
  process.env.VITE_PUBLIC_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
}
if (
  !process.env.VITE_PUBLIC_CONVEX_SITE_URL &&
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL
) {
  process.env.VITE_PUBLIC_CONVEX_SITE_URL =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
}

const required = [
  "PROD_E2E_PASSWORD",
  "E2E_CLEANUP_TOKEN",
  "MAILPIT_URL",
  "E2E_EMAIL_DOMAIN",
  "VITE_PUBLIC_CONVEX_URL",
  "VITE_PUBLIC_CONVEX_SITE_URL",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Missing production E2E variables: ${missing.join(", ")}\n` +
      "Create .env.production-e2e.local at the repo root or export them before running."
  );
  process.exit(1);
}

const run = (
  label: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; optional?: boolean } = {}
) => {
  console.log(`\n## ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, RUNNER_TEMP: runnerTemp, ...options.env },
    stdio: "inherit",
  });
  const code = result.status ?? 1;
  return { code, label, optional: Boolean(options.optional) };
};

const playwright = (label: string, projects: string[]) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return run(
    label,
    "bunx",
    [
      "playwright",
      "test",
      ...projects.flatMap((project) => [`--project=${project}`]),
      `--output=${join(resultsRoot, slug)}`,
    ],
    {
      cwd: testsDir,
      env: {
        CI: "1",
        PLAYWRIGHT_HTML_OUTPUT_DIR: join(reportRoot, slug),
      },
    }
  );
};

rmSync(reportRoot, { force: true, recursive: true });
rmSync(resultsRoot, { force: true, recursive: true });
rmSync(stateRoot, { force: true, recursive: true });
mkdirSync(runnerTemp, { recursive: true });
mkdirSync(resultsRoot, { recursive: true });

const results = [
  run("preflight", "bun", ["packages/tests/src/scripts/preflight.ts"]),
  run("smoke urls", "bash", ["scripts/smoke-urls.sh"]),
  run("orphan sweep", "bun", ["packages/tests/src/scripts/sweep.ts"]),
  run("install playwright browsers", "bunx", [
    "playwright",
    "install",
    "chromium",
    "firefox",
    "webkit",
  ]),
  playwright("docs", ["docs"]),
  run("build repo cli", "bun", ["run", "build:cli"]),
  run("install published cli", "npm", [
    "install",
    "--prefix",
    join(runnerTemp, "teak-npm"),
    "teak-cli@latest",
  ]),
  playwright("journey", [
    "journey-setup",
    "journey-web",
    "journey-services",
    "journey-a11y",
    "journey-security",
    "journey-account",
    "journey-delete",
    "journey-post-delete",
  ]),
  run(
    "journey teardown",
    "bun",
    ["run", "--cwd", "packages/tests", "teardown"],
    {
      optional: true,
    }
  ),
  playwright("matrix", ["matrix-chromium", "matrix-firefox", "matrix-webkit"]),
  run("build extension", "bun", ["run", "--cwd", "apps/extension", "build"]),
  playwright("extension", ["extension"]),
];

const failed = results.filter(
  (result) => result.code !== 0 && !result.optional
);
writeFileSync(
  join(resultsRoot, "prod-e2e-local-summary.json"),
  `${JSON.stringify({ failed, results }, null, 2)}\n`
);

if (failed.length > 0) {
  console.error(
    `\nProduction E2E local suite failed: ${failed
      .map((result) => result.label)
      .join(", ")}`
  );
  process.exit(1);
}

console.log("\nProduction E2E local suite passed.");
