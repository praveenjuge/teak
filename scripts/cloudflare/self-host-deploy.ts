#!/usr/bin/env bun

// Deploys a self-hosted Core Worker from apps/core-worker/self-host/wrangler.jsonc
// with the deployment's own values from self-host/.env, so a self-hoster
// never edits a committed config. Run it as `bun run deploy:self-host` from
// apps/core-worker; arguments after `--` go to `wrangler deploy` (for
// example `-- --dry-run --outdir /tmp/out`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeConvexSiteUrl } from "@teak/files-protocol";

const WORKER_DIR = join(import.meta.dir, "../../apps/core-worker");
export const SELF_HOST_DIR = join(WORKER_DIR, "self-host");
export const SELF_HOST_CONFIG = "self-host/wrangler.jsonc";
const VARS_FILE = join(SELF_HOST_DIR, ".env");
const SECRETS_FILE = join(SELF_HOST_DIR, ".env.secrets");

// The paths the API and MCP edge proxy answers on (src/edge/apiProxy.ts).
export const API_ROUTE_PATHS = [
  "/api*",
  "/mcp*",
  "/.well-known/oauth-protected-resource*",
  "/.well-known/teak-oauth-clients.json*",
] as const;

const REQUIRED_KEYS = ["CONVEX_SITE_URLS", "FILES_PUBLIC_ORIGIN"] as const;
const OPTIONAL_KEYS = [
  "API_PUBLIC_HOST",
  "API_UPSTREAM_ORIGIN",
  "API_WORKOS_ISSUER",
  "INBOUND_EMAIL_DOMAIN",
  "ANALYTICS_ACCOUNT_ID",
  "POSTHOG_PROJECT_TOKEN",
  "AI_GATEWAY_ID",
] as const;
export const SELF_HOST_KEYS: readonly string[] = [
  ...REQUIRED_KEYS,
  ...OPTIONAL_KEYS,
];

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const parseEnvFile = (text: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line
    );
    if (!match) {
      throw new Error(`Line ${index + 1} is not KEY=value`);
    }
    const [, key = "", rawValue = ""] = match;
    const quoted = /^(["'])(.*)\1$/.exec(rawValue);
    values[key] = quoted ? (quoted[2] ?? "") : rawValue.replace(/\s+#.*$/, "");
  }
  return values;
};

const httpsOrigin = (key: string, value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an https:// origin, got "${value}"`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${key} must be an https:// origin with no path, got "${value}"`
    );
  }
  return url.origin;
};

const hostname = (key: string, value: string): string => {
  const host = value.toLowerCase();
  if (!HOSTNAME.test(host)) {
    throw new Error(
      `${key} must be a hostname such as example.com, got "${value}"`
    );
  }
  return host;
};

export interface SelfHostDeployPlan {
  domains: string[];
  routes: string[];
  vars: Record<string, string>;
}

export const planSelfHostDeploy = (
  input: Record<string, string>
): SelfHostDeployPlan => {
  const values = Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0)
  );
  const unknown = Object.keys(values).filter(
    (key) => !SELF_HOST_KEYS.includes(key)
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown keys in self-host/.env: ${unknown.join(", ")}. Allowed: ${SELF_HOST_KEYS.join(", ")}`
    );
  }
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`self-host/.env is missing ${missing.join(", ")}`);
  }

  const convexSiteUrls = (values.CONVEX_SITE_URLS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const origin = normalizeConvexSiteUrl(entry);
      if (!origin) {
        throw new Error(
          `CONVEX_SITE_URLS must list Convex HTTP actions origins, got "${entry}"`
        );
      }
      return origin;
    });
  const filesOrigin = httpsOrigin(
    "FILES_PUBLIC_ORIGIN",
    values.FILES_PUBLIC_ORIGIN ?? ""
  );
  const vars: Record<string, string> = {
    CONVEX_SITE_URLS: convexSiteUrls.join(","),
    FILES_PUBLIC_ORIGIN: filesOrigin,
  };

  const filesHost = new URL(filesOrigin).hostname;
  const domains = filesHost.endsWith(".workers.dev") ? [] : [filesHost];

  const routes: string[] = [];
  if (values.API_PUBLIC_HOST) {
    const apiHost = hostname("API_PUBLIC_HOST", values.API_PUBLIC_HOST);
    if (!values.API_WORKOS_ISSUER) {
      throw new Error(
        "API_PUBLIC_HOST needs API_WORKOS_ISSUER, your WORKOS_AUTHKIT_DOMAIN"
      );
    }
    vars.API_PUBLIC_HOST = apiHost;
    vars.API_UPSTREAM_ORIGIN = values.API_UPSTREAM_ORIGIN
      ? httpsOrigin("API_UPSTREAM_ORIGIN", values.API_UPSTREAM_ORIGIN)
      : (convexSiteUrls[0] ?? "");
    vars.API_WORKOS_ISSUER = httpsOrigin(
      "API_WORKOS_ISSUER",
      values.API_WORKOS_ISSUER
    );
    routes.push(...API_ROUTE_PATHS.map((path) => `${apiHost}${path}`));
  } else if (values.API_UPSTREAM_ORIGIN || values.API_WORKOS_ISSUER) {
    throw new Error(
      "API_UPSTREAM_ORIGIN and API_WORKOS_ISSUER take effect only with API_PUBLIC_HOST"
    );
  }

  if (values.INBOUND_EMAIL_DOMAIN) {
    vars.INBOUND_EMAIL_DOMAIN = hostname(
      "INBOUND_EMAIL_DOMAIN",
      values.INBOUND_EMAIL_DOMAIN
    );
  }
  for (const key of [
    "ANALYTICS_ACCOUNT_ID",
    "POSTHOG_PROJECT_TOKEN",
    "AI_GATEWAY_ID",
  ] as const) {
    if (values[key]) {
      vars[key] = values[key];
    }
  }
  return { domains, routes, vars };
};

export const selfHostDeployArgs = (
  plan: SelfHostDeployPlan,
  options: { passthrough?: string[]; secretsFile?: string } = {}
): string[] => [
  "deploy",
  "--config",
  SELF_HOST_CONFIG,
  ...Object.entries(plan.vars).flatMap(([key, value]) => [
    "--var",
    `${key}:${value}`,
  ]),
  ...plan.domains.flatMap((domain) => ["--domain", domain]),
  ...plan.routes.flatMap((route) => ["--route", route]),
  ...(options.secretsFile ? ["--secrets-file", options.secretsFile] : []),
  ...(options.passthrough ?? []),
];

if (import.meta.main) {
  if (!existsSync(VARS_FILE)) {
    console.error(
      "Missing apps/core-worker/self-host/.env. Copy self-host/example.env to self-host/.env and fill it in."
    );
    process.exit(1);
  }
  let plan: SelfHostDeployPlan;
  try {
    plan = planSelfHostDeploy(parseEnvFile(readFileSync(VARS_FILE, "utf8")));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const args = selfHostDeployArgs(plan, {
    passthrough: process.argv.slice(2).filter((arg) => arg !== "--"),
    secretsFile: existsSync(SECRETS_FILE)
      ? "self-host/.env.secrets"
      : undefined,
  });
  console.log(`wrangler ${args.join(" ")}`);
  const child = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: WORKER_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await child.exited);
}
