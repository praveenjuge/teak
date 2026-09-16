/**
 * Derived environment classification, exposure, and derivation (issue #407).
 *
 * Every contract entry has exactly one owner (owners[0], the primary) and
 * exactly one classification. Classification and exposure are DERIVED from
 * the declared fields so they cannot drift; entries whose meaning the rules
 * misjudge carry an explicit `classification` override instead.
 */

import { canonicalFor, isFrameworkAlias } from "./env-aliases.ts";
import type {
  EnvClassification,
  EnvExposure,
  EnvVarSpec,
} from "./env-contract-types.ts";

export const classify = (entry: EnvVarSpec): EnvClassification => {
  if (entry.classification) {
    return entry.classification;
  }
  if (entry.secret) {
    return "secret";
  }
  if (entry.kind === "binding") {
    return "platform-binding";
  }
  if (isFrameworkAlias(entry.name) || entry.derivedFrom) {
    return "generated";
  }
  if (entry.providers.includes("build") || entry.validation === "sha") {
    return "build-metadata";
  }
  return "public-config";
};

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "VITE_", "EXPO_PUBLIC_"];

/** Framework mechanics decide exposure: these prefixes ship to clients. */
export const exposureOf = (entry: EnvVarSpec): EnvExposure =>
  PUBLIC_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
    ? "public"
    : "server";

export const primaryOwner = (entry: EnvVarSpec): string =>
  entry.owners[0] ?? "unowned";

/** Canonical fact, explicit source, or "supplied" for human/provider input. */
export const derivationRule = (entry: EnvVarSpec): string =>
  entry.derivedFrom ?? canonicalFor(entry.name) ?? "supplied";
