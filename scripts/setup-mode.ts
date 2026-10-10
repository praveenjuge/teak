/**
 * How setup wires sign-in and the backend for a checkout.
 *
 * Dev signs in through WorkOS staging on the shared cloud dev deployment
 * (scripts/dev-deployment.ts). Only the E2E suite uses the local WorkOS
 * emulator, on a local Convex backend with test-only values.
 */

import { listDeploymentVars, setDeploymentVars } from "./setup-convex.ts";
import { isMachineLocalValue } from "./setup-derived-env.ts";

export type WorkosMode = "emulator" | "staging";

/** No deployment yet (setup provisions a local one) or a local backend. */
export const isLocalSelection = (deployment: string | undefined): boolean =>
  !deployment ||
  deployment.startsWith("anonymous:") ||
  deployment.startsWith("local:");

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
