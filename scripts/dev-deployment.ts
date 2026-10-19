import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_TEAK_DEV_CONVEX_SITE_URL,
  DEFAULT_TEAK_DEV_CONVEX_URL,
  TEAK_DEV_DEPLOYMENT_NAME,
} from "../packages/convex/devUrls.ts";

export const DEV_DEPLOYMENT = `dev:${TEAK_DEV_DEPLOYMENT_NAME}`;

export const DEV_DEPLOYMENT_URLS = {
  convexUrl: DEFAULT_TEAK_DEV_CONVEX_URL,
  convexSiteUrl: DEFAULT_TEAK_DEV_CONVEX_SITE_URL,
} as const;

export type ConvexAccess =
  | { kind: "login" }
  | { kind: "deploy-key" }
  | { kind: "refused"; detail: string; remediation: string[] };

const KEY_REMEDIATION = [
  `Use a dev deploy key for ${TEAK_DEV_DEPLOYMENT_NAME} (\`bunx convex deployment token create <name> --deployment ${TEAK_DEV_DEPLOYMENT_NAME}\`), or unset CONVEX_DEPLOY_KEY and run \`bunx convex login\``,
];

export const resolveConvexAccess = (deployKey?: string): ConvexAccess => {
  const key = deployKey?.trim();
  if (!key) {
    return { kind: "login" };
  }
  const match = /^([a-z]+):([^|]+)\|/.exec(key);
  if (!match) {
    return {
      kind: "refused",
      detail:
        "CONVEX_DEPLOY_KEY is an admin key; dev accepts only a dev deploy key for the shared dev deployment",
      remediation: KEY_REMEDIATION,
    };
  }
  const [, type, target] = match;
  if (type === "dev" && target === TEAK_DEV_DEPLOYMENT_NAME) {
    return { kind: "deploy-key" };
  }
  const what: Record<string, string> = {
    prod: "selects production",
    preview: "selects a preview deployment",
    project: "can reach every deployment in the project, production included",
    dev: `selects the dev deployment ${target}, not ${TEAK_DEV_DEPLOYMENT_NAME}`,
  };
  return {
    kind: "refused",
    detail: `CONVEX_DEPLOY_KEY ${what[type] ?? `is a ${type} key`}`,
    remediation: KEY_REMEDIATION,
  };
};

export const readConvexAccess = (
  env: NodeJS.ProcessEnv = process.env
): ConvexAccess => resolveConvexAccess(env.CONVEX_DEPLOY_KEY);

export type SelectionPlan =
  | { action: "keep" }
  | { action: "select" }
  | { action: "refuse"; detail: string; remediation: string[] };

export const isLocalSelection = (
  deployment: string | undefined
): deployment is undefined | `anonymous:${string}` | `local:${string}` =>
  !deployment ||
  deployment.startsWith("anonymous:") ||
  deployment.startsWith("local:");

export const planDevSelection = (deployment?: string): SelectionPlan => {
  if (deployment === DEV_DEPLOYMENT) {
    return { action: "keep" };
  }
  if (isLocalSelection(deployment)) {
    return { action: "select" };
  }
  return {
    action: "refuse",
    detail: deployment.startsWith("prod:")
      ? `CONVEX_DEPLOYMENT selects production (${deployment})`
      : `CONVEX_DEPLOYMENT selects ${deployment}, not the shared dev deployment ${DEV_DEPLOYMENT}`,
    remediation: [
      `Remove CONVEX_DEPLOYMENT from packages/convex/.env.local (or unset the export) and re-run; setup selects ${DEV_DEPLOYMENT}`,
    ],
  };
};

const SELECTION_KEYS = ["CONVEX_DEPLOYMENT", "CONVEX_URL", "CONVEX_SITE_URL"];

export const writeConvexSelection = (
  dotenvPath: string,
  deployment: { name: string; url: string; siteUrl: string } | null
): void => {
  const lines = existsSync(dotenvPath)
    ? readFileSync(dotenvPath, "utf-8").replace(/\s+$/, "").split("\n")
    : [];
  const kept = lines
    .filter(
      (line) =>
        !SELECTION_KEYS.includes(line.split("=", 1)[0]?.trim() ?? "") ||
        line.trimStart().startsWith("#")
    )
    // The CLI adds its comment each time it selects a deployment; keep one.
    .filter(
      (line, i, all) =>
        !line.trimStart().startsWith("#") || all.indexOf(line) === i
    )
    .filter((line, i, all) => line.trim() || all[i - 1]?.trim());
  while (kept.length > 0 && !kept.at(-1)?.trim()) {
    kept.pop();
  }
  const added = deployment
    ? [
        `CONVEX_DEPLOYMENT=${deployment.name}`,
        `CONVEX_URL=${deployment.url}`,
        `CONVEX_SITE_URL=${deployment.siteUrl}`,
      ]
    : [];
  writeFileSync(dotenvPath, `${[...kept, ...added].join("\n")}\n`, {
    mode: 0o600,
  });
};

export const selectDevDeployment = (dotenvPath: string): void =>
  writeConvexSelection(dotenvPath, {
    name: DEV_DEPLOYMENT,
    url: DEV_DEPLOYMENT_URLS.convexUrl,
    siteUrl: DEV_DEPLOYMENT_URLS.convexSiteUrl,
  });

export const REQUIRED_DEV_VARS = ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"];

export const RECOMMENDED_DEV_VARS = [
  "TEAK_DEV_DEPLOYMENT",
  "TEAK_DEV_APP_URL",
  "TEAK_DEV_API_URL",
  "TEAK_DEV_DOCS_URL",
];
