/**
 * The shared cloud dev deployment that `bun run dev` uses in every checkout
 * and cloud session, and the rules for reaching it.
 *
 * A Mac checkout reaches it with the developer's Convex login, selected in
 * packages/convex/.env.local. A cloud session has no login; it exports a dev
 * deploy key scoped to this one deployment as CONVEX_DEPLOY_KEY. Any other
 * key or selection is refused, so dev never touches production.
 */

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

/**
 * How this process reaches the dev deployment. A deploy key must be a dev key
 * for the pinned deployment (`dev:<name>|…`); production, preview, project and
 * admin keys are refused.
 */
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

/** This process's access, read from its environment; never returns the key. */
export const readConvexAccess = (
  env: NodeJS.ProcessEnv = process.env
): ConvexAccess => resolveConvexAccess(env.CONVEX_DEPLOY_KEY);

export type SelectionPlan =
  | { action: "keep" }
  | { action: "select" }
  | { action: "refuse"; detail: string; remediation: string[] };

/**
 * What dev does with the checkout's current selection. Local and anonymous
 * backends are what the E2E stack provisions, so dev selects the shared
 * deployment over them; anything else a person chose is left alone.
 */
export const planDevSelection = (deployment?: string): SelectionPlan => {
  if (deployment === DEV_DEPLOYMENT) {
    return { action: "keep" };
  }
  if (
    !deployment ||
    deployment.startsWith("anonymous:") ||
    deployment.startsWith("local:")
  ) {
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

/**
 * Point packages/convex/.env.local at `deployment`, or clear the selection
 * when it is null (the E2E stack then provisions its local backend). Only the
 * selection keys the Convex CLI writes are touched; other lines stay.
 */
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

/** Deployment variables the web app needs; setup fails without them. */
export const REQUIRED_DEV_VARS = ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"];

/** Owner-managed variables that dev tooling uses; missing ones only warn. */
export const RECOMMENDED_DEV_VARS = [
  "TEAK_DEV_DEPLOYMENT",
  "TEAK_DEV_APP_URL",
  "TEAK_DEV_API_URL",
  "TEAK_DEV_DOCS_URL",
];
