/**
 * The Convex half of setup.
 *
 * Every checkout uses the shared cloud dev deployment
 * (scripts/dev-deployment.ts): setup selects it, checks that this machine can
 * reach it, and reads the WorkOS staging credentials the web app needs. It
 * never writes deployment variables and never pushes; `bun run dev` pushes
 * while it holds the push lease.
 */

import { join } from "node:path";
import { readConvexSelection } from "./capabilities.ts";
import {
  DEV_DEPLOYMENT,
  planDevSelection,
  RECOMMENDED_DEV_VARS,
  REQUIRED_DEV_VARS,
  readConvexAccess,
  selectDevDeployment,
} from "./dev-deployment.ts";
import type { SetupCheck } from "./setup.ts";
import { listDeploymentVarNames } from "./setup-convex.ts";
import {
  readWorkosCredentials,
  type WorkosCredentialName,
} from "./setup-workos.ts";

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
    const remediation =
      access.kind === "login"
        ? [
            "Run `bunx convex login` with an account that can open the Teak project, then re-run",
            "In a cloud session, add CONVEX_DEPLOY_KEY (a dev deploy key for the dev deployment) to the environment's secrets",
          ]
        : [
            "Check that CONVEX_DEPLOY_KEY is a current dev deploy key for the dev deployment",
          ];
    const detail = `could not reach ${DEV_DEPLOYMENT}: ${listed.detail}`;
    // --check only reports what setup would do; a real run needs the access.
    checks.push(
      checkOnly
        ? {
            id: "setup-convex-access",
            ok: true,
            severity: "warn",
            detail,
            remediation,
          }
        : error("setup-convex-access", detail, remediation)
    );
    return done(checkOnly);
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
