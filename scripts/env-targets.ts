import type { EnvProfile } from "./env-contract-types.ts";

export const SUPPORTED_TARGETS = [
  "web",
  "docs",
  "cli",
  "extension",
  "core-worker",
  "email-worker",
] as const;

export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export type ConvexMode = "cloud" | "skip";

export interface TargetSpec {
  defaultConvex: ConvexMode;
  dotenvFiles: string[];
  needsConvex: boolean;
  note: string;
  profiles: EnvProfile[];
  target: SupportedTarget;
}

export const TARGET_SPECS: Record<SupportedTarget, TargetSpec> = {
  web: {
    target: "web",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/web/.env.local"],
    needsConvex: true,
    defaultConvex: "cloud",
    note: "Next.js app on the shared cloud dev deployment; signs in through WorkOS staging.",
  },
  docs: {
    target: "docs",
    profiles: ["local", "preview", "production"],
    dotenvFiles: [],
    needsConvex: false,
    defaultConvex: "skip",
    note: "Documentation site. No local dotenv; defaults and flags apply.",
  },
  cli: {
    target: "cli",
    profiles: ["local", "preview", "production"],
    dotenvFiles: [],
    needsConvex: false,
    defaultConvex: "skip",
    note: "CLI reads TEAK_* overrides from the shell; no local dotenv file.",
  },
  extension: {
    target: "extension",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/extension/.env.local"],
    needsConvex: true,
    defaultConvex: "cloud",
    note: "Chrome extension. Setup derives VITE_PUBLIC_CONVEX_* from the canonical deployment pair.",
  },
  "core-worker": {
    target: "core-worker",
    profiles: ["local", "preview", "production"],
    dotenvFiles: [
      "apps/core-worker/.dev.vars",
      "apps/core-worker/development/.dev.vars",
    ],
    needsConvex: false,
    defaultConvex: "skip",
    note: "Cloudflare Worker. Local secrets live in .dev.vars (shared production Worker) or development/.dev.vars (isolated development Worker), synced from Convex dev.",
  },
  "email-worker": {
    target: "email-worker",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/email-worker/.dev.vars"],
    needsConvex: false,
    defaultConvex: "skip",
    note: "Save by email Cloudflare Worker. Its signing secret is a wrangler secret per environment; a local .dev.vars only serves `wrangler dev`.",
  },
};

export const isSupportedTarget = (value: string): value is SupportedTarget =>
  (SUPPORTED_TARGETS as readonly string[]).includes(value);

export const getTargetSpec = (target: SupportedTarget): TargetSpec =>
  TARGET_SPECS[target];

export const isSupportedCombo = (target: string, profile: string): boolean => {
  if (!isSupportedTarget(target)) {
    return false;
  }
  return (TARGET_SPECS[target].profiles as readonly string[]).includes(profile);
};

export const SUPPORTED_DOTENV_FILES: readonly string[] = [
  ...new Set(
    (Object.values(TARGET_SPECS) as TargetSpec[]).flatMap(
      (spec) => spec.dotenvFiles
    )
  ),
];

export const CONVEX_DOTENV_FILE = "packages/convex/.env.local";
