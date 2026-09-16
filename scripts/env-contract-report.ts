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
import type { EnvVarSpec } from "./env-contract-types.ts";

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

const main = (): void => {
  const args = process.argv.slice(2);
  const target = args.includes("--target")
    ? args[args.indexOf("--target") + 1]
    : undefined;
  const profile = args.includes("--profile")
    ? args[args.indexOf("--profile") + 1]
    : undefined;
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
