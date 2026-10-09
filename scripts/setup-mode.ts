/**
 * How setup wires sign-in and the backend for a checkout.
 *
 * `emulator` (the default for the web app and E2E): a local Convex backend
 * and the local WorkOS emulator, with test-only values and no secrets.
 * `staging`: a WorkOS staging environment, for work the emulator can't cover
 * (WorkOS Connect, AuthKit Actions). It needs exported staging credentials.
 */

import type { SupportedTarget } from "./env-targets.ts";
import { listDeploymentVars, setDeploymentVars } from "./setup-convex.ts";
import { isMachineLocalValue } from "./setup-derived-env.ts";

export type WorkosMode = "emulator" | "staging";
export const WORKOS_MODES: readonly WorkosMode[] = ["emulator", "staging"];

/** No deployment yet (setup provisions a local one) or a local backend. */
export const isLocalSelection = (deployment: string | undefined): boolean =>
  !deployment ||
  deployment.startsWith("anonymous:") ||
  deployment.startsWith("local:");

/**
 * An explicit choice wins. Otherwise a checkout keeps the wiring it has: a
 * cloud deployment or a backend that trusts production WorkOS is staging, a
 * backend that trusts a loopback emulator is the emulator. A new checkout
 * uses the emulator for the web app and E2E; other targets sign in with
 * WorkOS Connect, which only staging supports.
 */
export const resolveWorkosMode = (input: {
  deployment: string | undefined;
  deploymentApiBase: string | undefined;
  explicit: WorkosMode | null;
  target: SupportedTarget;
}): WorkosMode => {
  if (input.target === "e2e") {
    return "emulator";
  }
  if (input.explicit) {
    return input.explicit;
  }
  if (!isLocalSelection(input.deployment)) {
    return "staging";
  }
  if (input.deploymentApiBase) {
    return isMachineLocalValue("WORKOS_API_BASE_URL", input.deploymentApiBase)
      ? "emulator"
      : "staging";
  }
  return input.target === "web" ? "emulator" : "staging";
};

export type DeploymentVarsResult =
  | { configured: string[]; ok: true }
  | { detail: string; ok: false };

/**
 * Set every missing variable and refresh machine-local ones (old ports).
 * A different value a person set is a conflict and is left alone.
 */
export const ensureDeploymentVars = async (
  convexDir: string,
  desired: Record<string, string>,
  /** The deployment's variables when the caller already read them. */
  known?: Awaited<ReturnType<typeof listDeploymentVars>>
): Promise<DeploymentVarsResult> => {
  const listed = known ?? (await listDeploymentVars(convexDir));
  if (listed.status === "unavailable") {
    return {
      ok: false,
      detail: `could not read the deployment's variables: ${listed.detail}`,
    };
  }
  const conflicts: string[] = [];
  const toSet: [string, string][] = [];
  for (const [name, value] of Object.entries(desired)) {
    const current = listed.values.get(name);
    if (current === value) {
      continue;
    }
    if (
      current === undefined ||
      (isMachineLocalValue(name, current) && isMachineLocalValue(name, value))
    ) {
      toSet.push([name, value]);
    } else {
      conflicts.push(name);
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      detail: `the deployment already sets ${conflicts.join(", ")} to other values`,
    };
  }
  await setDeploymentVars(Object.fromEntries(toSet), convexDir);
  return { ok: true, configured: toSet.map(([name]) => name) };
};
