/**
 * Supported setup/doctor/dev target matrix for issue #407.
 *
 * One table drives the explicit dotenv loader, setup, doctor, and dev: which
 * (target, profile) combinations are supported, which dotenv files each
 * combination owns, and whether it needs a Convex deployment. No other dotenv
 * file is ever consumed implicitly by a supported command.
 */

import type { EnvProfile } from "./env-contract-types.ts";

export const SUPPORTED_TARGETS = [
  "web",
  "docs",
  "cli",
  "desktop",
  "extension",
  "mobile-simulator",
  "mobile-device",
  "files-worker",
  "e2e",
] as const;

export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export type ConvexMode = "local" | "cloud" | "skip";

export interface TargetSpec {
  defaultConvex: ConvexMode;
  /** Repo-relative dotenv files this target owns, in load order. */
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
    defaultConvex: "local",
    note: "Next.js app plus Convex backend. Local E2E credentials live in apps/web/.env.e2e.local, never in the build input.",
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
  desktop: {
    target: "desktop",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/desktop/.env.local"],
    needsConvex: true,
    defaultConvex: "local",
    note: "Electron app. Setup derives VITE_PUBLIC_CONVEX_* from the canonical deployment pair.",
  },
  extension: {
    target: "extension",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/extension/.env.local"],
    needsConvex: true,
    defaultConvex: "local",
    note: "Chrome extension. Setup derives VITE_PUBLIC_CONVEX_* from the canonical deployment pair.",
  },
  "mobile-simulator": {
    target: "mobile-simulator",
    profiles: ["local"],
    dotenvFiles: ["apps/mobile/.env.local"],
    needsConvex: true,
    defaultConvex: "local",
    note: "Expo on a simulator. Loopback origins work; no LAN inference needed.",
  },
  "mobile-device": {
    target: "mobile-device",
    profiles: ["local"],
    dotenvFiles: ["apps/mobile/.env.local"],
    needsConvex: true,
    defaultConvex: "local",
    note: "Expo on a physical device. Requires a LAN-reachable host; doctor reports an actionable diagnostic when none can be inferred.",
  },
  "files-worker": {
    target: "files-worker",
    profiles: ["local", "preview", "production"],
    dotenvFiles: ["apps/files-worker/.dev.vars"],
    needsConvex: false,
    defaultConvex: "skip",
    note: "Cloudflare Worker. Local secrets live in .dev.vars, synced from Convex locally.",
  },
  e2e: {
    target: "e2e",
    profiles: ["e2e"],
    dotenvFiles: [
      ".env.e2e.local",
      "apps/web/.env.e2e.local",
      ".env.production-e2e.local",
    ],
    needsConvex: true,
    defaultConvex: "cloud",
    note: "Test-only scope. Production-suite file is .env.production-e2e.local; local web E2E uses apps/web/.env.e2e.local.",
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

/** Every dotenv file any supported command may read, repo-relative. */
export const SUPPORTED_DOTENV_FILES: readonly string[] = [
  ...new Set(
    (Object.values(TARGET_SPECS) as TargetSpec[]).flatMap(
      (spec) => spec.dotenvFiles
    )
  ),
];

/** Convex-side deployment pointer read explicitly for local derivation. */
export const CONVEX_DOTENV_FILE = "packages/convex/.env.local";
