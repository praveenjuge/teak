/**
 * The Convex half of setup.
 *
 * Dev (`bun run dev`, every target but e2e) uses the shared cloud dev
 * deployment (scripts/dev-deployment.ts): setup selects it, checks that this
 * machine can reach it, and reads the WorkOS staging credentials the web app
 * needs. It never writes deployment variables and never pushes; `bun run dev`
 * pushes while it holds the push lease.
 *
 * The E2E suite uses a local backend wired to the WorkOS emulator, with
 * test-only values (packages/tests/src/stack/config.ts) and no secrets. It
 * takes over packages/convex/.env.local while it runs; the next dev setup
 * selects the dev deployment again.
 */

import { join } from "node:path";
import { emulatorDeploymentVars } from "../packages/tests/src/stack/config.ts";
import { readConvexSelection } from "./capabilities.ts";
import {
  DEV_DEPLOYMENT,
  planDevSelection,
  RECOMMENDED_DEV_VARS,
  REQUIRED_DEV_VARS,
  readConvexAccess,
  selectDevDeployment,
  writeConvexSelection,
} from "./dev-deployment.ts";
import type { SetupCheck } from "./setup.ts";
import {
  convexDevOnce,
  ensureLocalStateMarker,
  listDeploymentVarNames,
} from "./setup-convex.ts";
import { ensureDeploymentVars, isLocalSelection } from "./setup-mode.ts";
import {
  readWorkosCredentials,
  type WorkosCredentialName,
} from "./setup-workos.ts";
import type { WorktreePorts } from "./worktree-env.ts";

const convexDirOf = (root: string) => join(root, "packages/convex");

const error = (
  id: string,
  detail: string,
  remediation: string[]
): SetupCheck => ({ id, ok: false, severity: "error", detail, remediation });

const ok = (id: string, detail: string): SetupCheck => ({
  id,
  ok: true,
  severity: "error",
  detail,
});

export interface DevDeploymentSetup {
  checks: SetupCheck[];
  ok: boolean;
  workos: Partial<Record<WorkosCredentialName, string>>;
}

export const setupDevDeployment = async (
  root: string,
  checkOnly: boolean
): Promise<DevDeploymentSetup> => {
  const checks: SetupCheck[] = [];
  const done = (passed: boolean, workos = {}) => ({
    checks,
    ok: passed,
    workos,
  });
  const convexDir = convexDirOf(root);
  const dotenvPath = join(convexDir, ".env.local");

  const access = readConvexAccess();
  if (access.kind === "refused") {
    checks.push(
      error("setup-convex-selection", access.detail, access.remediation)
    );
    return done(false);
  }
  const selection = readConvexSelection(process.env, dotenvPath);
  const plan = planDevSelection(selection.deployment);
  if (plan.action === "refuse") {
    checks.push(error("setup-convex-selection", plan.detail, plan.remediation));
    return done(false);
  }
  if (plan.action === "select" && selection.source === "env") {
    checks.push(
      error(
        "setup-convex-selection",
        `the exported CONVEX_DEPLOYMENT (${selection.deployment}) overrides packages/convex/.env.local`,
        ["Unset CONVEX_DEPLOYMENT in this shell and re-run"]
      )
    );
    return done(false);
  }
  if (plan.action === "select" && !checkOnly) {
    selectDevDeployment(dotenvPath);
  }
  // Every Convex CLI call below targets the dev deployment, even in --check
  // before the selection is written. A deploy key selects it by itself.
  if (access.kind === "login") {
    process.env.CONVEX_DEPLOYMENT = DEV_DEPLOYMENT;
  }
  const via =
    access.kind === "login" ? "your Convex login" : "CONVEX_DEPLOY_KEY";
  const leftover =
    plan.action === "select" && selection.deployment
      ? ` (replacing ${selection.deployment}; its local data stays in packages/convex/.convex)`
      : "";
  checks.push(
    ok(
      "setup-convex-selection",
      `${checkOnly && plan.action === "select" ? "would select" : "using"} the shared dev deployment ${DEV_DEPLOYMENT} through ${via}${leftover}`
    )
  );

  const listed = await listDeploymentVarNames(convexDir);
  if (listed.status === "unavailable") {
    checks.push(
      error(
        "setup-convex-access",
        `could not reach ${DEV_DEPLOYMENT}: ${listed.detail}`,
        access.kind === "login"
          ? [
              "Run `bunx convex login` with an account that can open the Teak project, then re-run",
              "In a cloud session, add CONVEX_DEPLOY_KEY (a dev deploy key for the dev deployment) to the environment's secrets",
            ]
          : [
              "Check that CONVEX_DEPLOY_KEY is a current dev deploy key for the dev deployment",
            ]
      )
    );
    return done(false);
  }
  const missing = REQUIRED_DEV_VARS.filter((name) => !listed.names.has(name));
  if (missing.length > 0) {
    checks.push(
      error(
        "setup-convex-access",
        `the dev deployment is missing ${missing.join(", ")}`,
        [
          "The repository owner sets them from WorkOS staging in the Convex dashboard (see .agents/development.md)",
        ]
      )
    );
    return done(false);
  }
  const unset = RECOMMENDED_DEV_VARS.filter((name) => !listed.names.has(name));
  checks.push(
    unset.length === 0
      ? ok(
          "setup-convex-access",
          "the dev deployment is reachable and configured"
        )
      : {
          id: "setup-convex-access",
          ok: true,
          severity: "warn",
          detail: `the dev deployment is reachable but doesn't set ${unset.join(", ")}`,
          remediation: [
            "The repository owner sets them once (see .agents/development.md); until then seeding and the push lease are off",
          ],
        }
  );

  if (checkOnly) {
    checks.push(
      ok(
        "setup-workos",
        "would read WORKOS_CLIENT_ID and WORKOS_API_KEY from the dev deployment"
      )
    );
    return done(true);
  }
  const credentials = await readWorkosCredentials(convexDir);
  checks.push(credentials.check);
  if (!credentials.check.ok) {
    return done(false);
  }
  checks.push(
    ok(
      "setup-convex-push",
      "skipped: bun run dev pushes this checkout's backend while it holds the push lease"
    )
  );
  return done(true, credentials.values);
};

export interface E2eBackendOptions {
  /** Push backend code (default); the E2E stack pushes once itself. */
  push?: boolean;
}

export const setupE2eBackend = async (
  root: string,
  worktree: WorktreePorts,
  checkOnly: boolean,
  options: E2eBackendOptions
): Promise<{ checks: SetupCheck[]; ok: boolean }> => {
  const checks: SetupCheck[] = [];
  const done = (passed: boolean) => ({ checks, ok: passed });
  const convexDir = convexDirOf(root);
  const dotenvPath = join(convexDir, ".env.local");

  let selection = readConvexSelection(process.env, dotenvPath);
  if (
    selection.deployment === DEV_DEPLOYMENT &&
    selection.source === "dotenv" &&
    !checkOnly
  ) {
    // Dev's selection: the E2E backend takes its turn.
    writeConvexSelection(dotenvPath, null);
    selection = { source: "none" };
  }
  if (
    selection.deployment &&
    !isLocalSelection(selection.deployment) &&
    selection.deployment !== DEV_DEPLOYMENT
  ) {
    checks.push(
      error(
        "setup-convex-selection",
        `CONVEX_DEPLOYMENT selects ${selection.deployment}; the E2E suite needs a local backend`,
        [
          "Unset the CONVEX_DEPLOYMENT export or remove it from packages/convex/.env.local, then re-run",
        ]
      )
    );
    return done(false);
  }
  // The E2E stack never uses a cloud deployment: drop a cloud session's deploy
  // key, and have every child Convex CLI pick the local anonymous backend.
  delete process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_AGENT_MODE = "anonymous";
  const ports = { convex: worktree.convex, convexSite: worktree.convexSite };
  checks.push(
    ok(
      "setup-convex-selection",
      selection.deployment
        ? `preserving ${selection.deployment} (from ${selection.source}); WorkOS: emulator`
        : "none selected (convex dev will provision a local backend); WorkOS: emulator"
    )
  );
  if (checkOnly) {
    checks.push(
      ok(
        "setup-convex-deploy-vars",
        "would point the local backend at the WorkOS emulator and set SITE_URL"
      ),
      ok(
        "setup-convex-push",
        "would run `bunx convex dev --once` in packages/convex"
      )
    );
    return done(true);
  }

  // Provision first when nothing is selected: the first push may fail on
  // missing variables, which the next step configures before the final push.
  if (!selection.deployment) {
    const provision = await convexDevOnce(convexDir, { ports });
    checks.push(
      ok(
        "setup-convex-provision",
        provision.ok
          ? `provisioned (${provision.detail})`
          : `deferred (${provision.detail})`
      )
    );
  }
  ensureLocalStateMarker(convexDir);
  // auth.config.ts reads the WorkOS values, so they are set before the push.
  const vars = await ensureDeploymentVars(convexDir, {
    SITE_URL: worktree.siteUrl,
    ...emulatorDeploymentVars(worktree),
  });
  if (!vars.ok) {
    checks.push(
      error("setup-workos", vars.detail, [
        "Remove those variables with `bunx convex env remove <NAME>` in packages/convex and re-run",
      ])
    );
    return done(false);
  }
  checks.push(
    ok(
      "setup-workos",
      vars.configured.length > 0
        ? `configured ${vars.configured.join(", ")} for the WorkOS emulator`
        : "the local backend already points at the WorkOS emulator"
    )
  );
  if (options.push !== false) {
    const push = await convexDevOnce(convexDir, { ports });
    if (!push.ok) {
      checks.push(
        error("setup-convex-push", `convex dev --once failed: ${push.detail}`, [
          "Fix the push error above and re-run bun run setup --target e2e",
        ])
      );
      return done(false);
    }
    checks.push(ok("setup-convex-push", "code pushed and types generated"));
  }
  return done(true);
};
