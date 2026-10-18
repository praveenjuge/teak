import type { SetupCheck } from "./setup.ts";
import { readDeploymentVar } from "./setup-convex.ts";

export const WORKOS_CREDENTIAL_NAMES = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
] as const;
export type WorkosCredentialName = (typeof WORKOS_CREDENTIAL_NAMES)[number];

export type WorkosCredentialPlan =
  | { detail: string; name: WorkosCredentialName; status: "invalid" }
  | { name: WorkosCredentialName; status: "ready"; value: string };

const present = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;

export const planWorkosCredential = (
  name: WorkosCredentialName,
  sources: { deployment?: string; explicit?: string }
): WorkosCredentialPlan => {
  const deployment = present(sources.deployment);
  if (!deployment) {
    return {
      name,
      status: "invalid",
      detail: `${name} is missing on the dev deployment`,
    };
  }
  if (name === "WORKOS_API_KEY" && deployment.startsWith("sk_live_")) {
    return {
      name,
      status: "invalid",
      detail:
        "WORKOS_API_KEY on the dev deployment is a production key; dev uses WorkOS staging",
    };
  }
  const explicit = present(sources.explicit);
  if (explicit && explicit !== deployment) {
    return {
      name,
      status: "invalid",
      detail: `the exported ${name} differs from the dev deployment's; unset it`,
    };
  }
  return { name, status: "ready", value: deployment };
};

export type WorkosSetupCheck = SetupCheck & {
  detail: string;
  id: "setup-workos";
  severity: "error";
};

const OWNER_REMEDIATION = [
  "The repository owner sets WORKOS_CLIENT_ID and WORKOS_API_KEY from WorkOS staging on the dev deployment in the Convex dashboard",
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

export const readWorkosCredentials = async (
  convexDir: string,
  explicit: Partial<Record<string, string>> = process.env
): Promise<{
  check: WorkosSetupCheck;
  values: Partial<Record<WorkosCredentialName, string>>;
}> => {
  const values: Partial<Record<WorkosCredentialName, string>> = {};
  for (const name of WORKOS_CREDENTIAL_NAMES) {
    const deployment = await readDeploymentVar(name, convexDir);
    if (deployment.status === "unavailable") {
      return failure(
        `could not read ${name} from the dev deployment: ${deployment.detail}`,
        ["Run `bunx convex login` (or check CONVEX_DEPLOY_KEY) and re-run"]
      );
    }
    const plan = planWorkosCredential(name, {
      deployment: deployment.status === "found" ? deployment.value : undefined,
      explicit: explicit[name],
    });
    if (plan.status === "invalid") {
      return failure(
        plan.detail,
        plan.detail.includes("exported")
          ? [`Unset ${name} in this shell and re-run`]
          : OWNER_REMEDIATION
      );
    }
    values[name] = plan.value;
  }
  return {
    check: {
      id: "setup-workos",
      ok: true,
      severity: "error",
      detail: "WorkOS staging credentials read from the dev deployment",
    },
    values,
  };
};
