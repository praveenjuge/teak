#!/usr/bin/env bun

/**
 * Baseline metrics report for the environment contract (issue #407, Phase 0).
 *
 * Records total entries, required values, secrets, implicit values, bindings,
 * generated aliases, and per-target/profile manual-supply counts from
 * ./env-contract.ts. Names and metadata only, never values.
 *
 * Usage: bun run scripts/env-contract-report.ts [--json] [--target <t>] [--profile <p>]
 */

import { isFrameworkAlias } from "./env-aliases.ts";
import { ENV_CONTRACT } from "./env-contract.ts";
import type {
  EnvTarget,
  EnvValidation,
  EnvVarSpec,
} from "./env-contract-types.ts";
import { loadTargetEnv } from "./env-loader.ts";
import { isSupportedTarget, type SupportedTarget } from "./env-targets.ts";

export const CONTRACT_REPORT_VERSION = 1;

export interface TargetProfileCounts {
  manualRequired: number;
  profile: string;
  required: number;
  target: string;
}

export interface ContractReport {
  aliases: number;
  bindings: number;
  byTargetProfile: TargetProfileCounts[];
  implicit: number;
  required: number;
  secrets: number;
  total: number;
  version: number;
}

/** Entries whose required value a human or provider must supply by hand. */
export const isManuallySupplied = (entry: EnvVarSpec): boolean =>
  !(entry.implicit || isFrameworkAlias(entry.name));

export const buildContractReport = (
  entries: EnvVarSpec[] = ENV_CONTRACT
): ContractReport => {
  const combos = new Map<string, TargetProfileCounts>();
  for (const entry of entries) {
    for (const target of entry.targets) {
      for (const profile of entry.requiredIn ?? []) {
        const key = `${target}/${profile}`;
        const counts = combos.get(key) ?? {
          target,
          profile,
          required: 0,
          manualRequired: 0,
        };
        counts.required += 1;
        if (isManuallySupplied(entry)) {
          counts.manualRequired += 1;
        }
        combos.set(key, counts);
      }
    }
  }
  return {
    version: CONTRACT_REPORT_VERSION,
    total: entries.length,
    required: entries.filter((entry) => entry.required).length,
    secrets: entries.filter((entry) => entry.secret).length,
    implicit: entries.filter((entry) => entry.implicit).length,
    bindings: entries.filter((entry) => entry.kind === "binding").length,
    aliases: entries.filter((entry) => isFrameworkAlias(entry.name)).length,
    byTargetProfile: [...combos.values()].sort((a, b) =>
      `${a.target}/${a.profile}`.localeCompare(`${b.target}/${b.profile}`)
    ),
  };
};

export interface MissingEntry {
  example: string;
  name: string;
  providers: string[];
  reason: string;
}

/** Placeholder examples by validation shape. Never real values. */
export const exampleForValidation = (
  validation: EnvValidation,
  allowedValues?: string[]
): string => {
  switch (validation) {
    case "url":
      return "https://example.com";
    case "origin":
      return "https://example.com";
    case "email":
      return "you@example.com";
    case "number":
      return "1234";
    case "boolean":
      return "true";
    case "enum":
      return allowedValues?.[0] ?? "value";
    case "sha":
      return "<40-char-hex-sha>";
    case "path":
      return "/absolute/path";
    default:
      return "<value>";
  }
};

const toContractTarget = (target: SupportedTarget): EnvTarget => {
  if (target === "mobile-simulator" || target === "mobile-device") {
    return "mobile";
  }
  return target;
};

/** Required names for a combo that are absent from `present`. */
export const missingEntries = (
  target: SupportedTarget,
  profile: string,
  present: Set<string>,
  entries: EnvVarSpec[] = ENV_CONTRACT
): MissingEntry[] => {
  const contractTarget = toContractTarget(target);
  return entries
    .filter(
      (entry) =>
        entry.targets.includes(contractTarget) &&
        (entry.requiredIn ?? []).includes(
          profile as (typeof entry.profiles)[number]
        ) &&
        !present.has(entry.name)
    )
    .map((entry) => ({
      name: entry.name,
      example: `${entry.name}=${exampleForValidation(entry.validation, entry.allowedValues)}`,
      providers: [...entry.providers],
      reason: entry.derivedFrom
        ? `generated from ${entry.derivedFrom}; run setup`
        : `required ${contractTarget}/${profile} input`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export interface MissingReport {
  missing: MissingEntry[];
  profile: string;
  target: SupportedTarget;
  version: number;
}

export const buildMissingReport = (
  target: SupportedTarget,
  profile: string,
  present?: Set<string>
): MissingReport => {
  const names =
    present ??
    new Set([
      ...loadTargetEnv(target, profile as "local").values.keys(),
      ...Object.keys(process.env),
    ]);
  return {
    version: CONTRACT_REPORT_VERSION,
    target,
    profile,
    missing: missingEntries(target, profile, names),
  };
};

const main = (): void => {
  const args = process.argv.slice(2);
  const target = args.includes("--target")
    ? args[args.indexOf("--target") + 1]
    : undefined;
  const profile = args.includes("--profile")
    ? args[args.indexOf("--profile") + 1]
    : undefined;
  if (args.includes("--missing")) {
    if (!(target && isSupportedTarget(target))) {
      console.error(
        "usage: bun run scripts/env-contract-report.ts --missing --target <target> --profile <profile> [--json]"
      );
      process.exitCode = 1;
      return;
    }
    const report = buildMissingReport(target, profile ?? "local");
    if (args.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (report.missing.length === 0) {
      console.log(
        `contract: no missing required names for ${target}/${profile ?? "local"}.`
      );
      return;
    }
    console.log(
      [
        `contract: ${report.missing.length} missing required name(s) for ${target}/${profile ?? "local"}:`,
        ...report.missing.map(
          (entry) =>
            `  ${entry.example}  # ${entry.reason} (provide via ${entry.providers.join(", ")})`
        ),
      ].join("\n")
    );
    return;
  }
  const report = buildContractReport();
  if (target ?? profile) {
    report.byTargetProfile = report.byTargetProfile.filter(
      (counts) =>
        (!target || counts.target === target) &&
        (!profile || counts.profile === profile)
    );
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    [
      `contract: ${report.total} entries, ${report.required} required, ${report.secrets} secrets, ${report.implicit} implicit, ${report.bindings} bindings, ${report.aliases} generated aliases.`,
      ...report.byTargetProfile.map(
        (counts) =>
          `  ${counts.target}/${counts.profile}: ${counts.required} required (${counts.manualRequired} manual).`
      ),
    ].join("\n")
  );
};

if (import.meta.main) {
  main();
}
