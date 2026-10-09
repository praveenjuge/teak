/**
 * WorkOS credentials for setup.
 *
 * WorkOS AuthKit is Teak's only sign-in provider, so every Convex deployment
 * and the web server need the same WorkOS client ID and API key. Setup takes
 * them from an explicit shell export, the selected deployment, or the web
 * dotenv file, and never overwrites a value that is already set. Values are
 * compared but never logged.
 */

import {
  isWorkosProductionApi,
  parseWorkosApiBase,
} from "../packages/convex/shared/workosApi";
import { readDotenvFile } from "./env-loader.ts";
import { readDeploymentVar, setDeploymentVar } from "./setup-convex.ts";

export const WORKOS_CREDENTIAL_NAMES = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
] as const;
export type WorkosCredentialName = (typeof WORKOS_CREDENTIAL_NAMES)[number];

export interface WorkosCredentialSources {
  deployment?: string;
  explicit?: string;
  web?: string;
}

export type WorkosCredentialPlan =
  | { name: WorkosCredentialName; status: "missing" }
  | { detail: string; name: WorkosCredentialName; status: "conflict" }
  | {
      name: WorkosCredentialName;
      setDeployment: boolean;
      status: "ready";
      value: string;
    };

const SOURCE_LABELS: Record<keyof WorkosCredentialSources, string> = {
  deployment: "the Convex deployment",
  explicit: "the shell export",
  web: "apps/web/.env.local",
};

const present = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;

/**
 * Precedence follows .agents/environment.md: an explicit export wins, then the
 * deployment, then the web dotenv file. Every source that is set must agree,
 * because setup never overwrites a value and a split client breaks sign-in.
 */
export const planWorkosCredential = (
  name: WorkosCredentialName,
  sources: WorkosCredentialSources
): WorkosCredentialPlan => {
  const set = (
    Object.keys(SOURCE_LABELS) as (keyof WorkosCredentialSources)[]
  ).flatMap((source) => {
    const value = present(sources[source]);
    return value ? [{ source, value }] : [];
  });
  const chosen = set[0];
  if (!chosen) {
    return { name, status: "missing" };
  }
  const disagreeing = set.find((entry) => entry.value !== chosen.value);
  if (disagreeing) {
    return {
      name,
      status: "conflict",
      detail: `${name} differs between ${SOURCE_LABELS[chosen.source]} and ${SOURCE_LABELS[disagreeing.source]}`,
    };
  }
  return {
    name,
    status: "ready",
    value: chosen.value,
    setDeployment: present(sources.deployment) === undefined,
  };
};

export const WORKOS_PRODUCTION_API = "https://api.workos.com";

export type WorkosApiBasePlan =
  | { setDeployment: boolean; status: "ready"; value: string }
  | { detail: string; status: "invalid" };

const apiBaseProblem = (
  value: string,
  localBackend: boolean
): string | undefined => {
  let base: URL;
  try {
    base = parseWorkosApiBase(value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return localBackend || isWorkosProductionApi(base)
    ? undefined
    : "the WorkOS emulator only works with a local backend (--convex local)";
};

/**
 * Local backends read WORKOS_API_BASE_URL in their auth config, and Convex
 * rejects an auth config that reads an unset variable, so every deployment gets
 * one. An existing value wins; otherwise an export (the WorkOS emulator) or
 * production WorkOS. Both are checked with the backend's own parser, and a
 * cloud deployment never gets a loopback origin it can't reach.
 */
export const planWorkosApiBase = (sources: {
  deployment?: string;
  explicit?: string;
  localBackend: boolean;
}): WorkosApiBasePlan => {
  const deployment = present(sources.deployment);
  if (deployment) {
    const problem = apiBaseProblem(deployment, sources.localBackend);
    return problem
      ? {
          status: "invalid",
          detail: `WORKOS_API_BASE_URL on the deployment is invalid: ${problem}`,
        }
      : { status: "ready", value: deployment, setDeployment: false };
  }
  const explicit = present(sources.explicit);
  const problem = explicit && apiBaseProblem(explicit, sources.localBackend);
  if (problem) {
    return {
      status: "invalid",
      detail: `exported WORKOS_API_BASE_URL is invalid: ${problem}`,
    };
  }
  return {
    status: "ready",
    value: explicit ?? WORKOS_PRODUCTION_API,
    setDeployment: true,
  };
};

const API_BASE_REMEDIATION = [
  "Run `bunx convex env set WORKOS_API_BASE_URL https://api.workos.com` in packages/convex, or the WorkOS emulator origin on a local backend, then re-run bun run setup",
];

export const WORKOS_SETUP_REMEDIATION = [
  "This checkout signs in through WorkOS staging. Export WORKOS_CLIENT_ID and WORKOS_API_KEY from a WorkOS staging or development environment (never production), then re-run",
  "See the Development guide in the docs for the WorkOS environment settings Teak needs",
];

export const WORKOS_CONFLICT_REMEDIATION = [
  "Setup never overwrites a set value: update it with `bunx convex env set <NAME>` in packages/convex and in apps/web/.env.local, or unset the conflicting shell export",
];

/** Same shape as setup's SetupCheck; declared here to avoid an import cycle. */
export interface WorkosSetupCheck {
  detail: string;
  id: "setup-workos";
  ok: boolean;
  remediation?: string[];
  severity: "error";
}

/**
 * Resolve the WorkOS client ID and API key, set missing deployment values, and
 * return them for the web dotenv file. Values are compared, never reported.
 */
const LOGIN_REMEDIATION = [
  "Run `bunx convex login` (or export CONVEX_AGENT_MODE=anonymous) and re-run",
];

const failure = (detail: string, remediation: string[]) => ({
  check: {
    id: "setup-workos" as const,
    ok: false,
    severity: "error" as const,
    detail,
    remediation,
  },
  values: {},
});

export const ensureWorkosCredentials = async (
  convexDir: string,
  webEnvPath: string | undefined,
  localBackend: boolean,
  // Explicit values win over the deployment and the web dotenv file: shell
  // exports by default, or the e2e stack's WorkOS emulator settings.
  explicit: Partial<Record<string, string>> = process.env
): Promise<{
  check: WorkosSetupCheck;
  values: Partial<Record<WorkosCredentialName, string>>;
}> => {
  const web = webEnvPath ? readDotenvFile(webEnvPath)?.values : undefined;
  const plans: WorkosCredentialPlan[] = [];
  for (const name of WORKOS_CREDENTIAL_NAMES) {
    const deployment = await readDeploymentVar(name, convexDir);
    if (deployment.status === "unavailable") {
      return failure(
        `could not read ${name} from the selected deployment: ${deployment.detail}`,
        LOGIN_REMEDIATION
      );
    }
    plans.push(
      planWorkosCredential(name, {
        explicit: explicit[name],
        deployment:
          deployment.status === "found" ? deployment.value : undefined,
        web: web?.get(name),
      })
    );
  }
  const missing = plans.filter((plan) => plan.status === "missing");
  if (missing.length > 0) {
    return failure(
      `WorkOS sign-in is not configured: ${missing.map((plan) => plan.name).join(", ")} missing`,
      WORKOS_SETUP_REMEDIATION
    );
  }
  const conflicts = plans.flatMap((plan) =>
    plan.status === "conflict" ? [plan.detail] : []
  );
  if (conflicts.length > 0) {
    return failure(conflicts.join("; "), WORKOS_CONFLICT_REMEDIATION);
  }
  const values: Partial<Record<WorkosCredentialName, string>> = {};
  const configured: string[] = [];
  for (const plan of plans) {
    if (plan.status !== "ready") {
      continue;
    }
    values[plan.name] = plan.value;
    if (plan.setDeployment) {
      try {
        await setDeploymentVar(plan.name, plan.value, convexDir);
      } catch (error) {
        return failure(
          error instanceof Error ? error.message : String(error),
          LOGIN_REMEDIATION
        );
      }
      configured.push(plan.name);
    }
  }
  const baseVar = await readDeploymentVar("WORKOS_API_BASE_URL", convexDir);
  if (baseVar.status === "unavailable") {
    return failure(
      `could not read WORKOS_API_BASE_URL from the selected deployment: ${baseVar.detail}`,
      LOGIN_REMEDIATION
    );
  }
  const base = planWorkosApiBase({
    explicit: explicit.WORKOS_API_BASE_URL,
    deployment: baseVar.status === "found" ? baseVar.value : undefined,
    localBackend,
  });
  if (base.status === "invalid") {
    return failure(base.detail, API_BASE_REMEDIATION);
  }
  if (base.setDeployment) {
    try {
      await setDeploymentVar("WORKOS_API_BASE_URL", base.value, convexDir);
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : String(error),
        LOGIN_REMEDIATION
      );
    }
    configured.push("WORKOS_API_BASE_URL");
  }
  return {
    check: {
      id: "setup-workos",
      ok: true,
      severity: "error",
      detail:
        configured.length > 0
          ? `configured ${configured.join(", ")} on the deployment`
          : "WorkOS settings already set on the deployment",
    },
    values,
  };
};
