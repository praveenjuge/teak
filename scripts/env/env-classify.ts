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
  if (isFrameworkAlias(entry.name)) {
    return "generated";
  }
  if (entry.providers.includes("build") || entry.validation === "sha") {
    return "build-metadata";
  }
  if (entry.derivedFrom) {
    return "generated";
  }
  return "public-config";
};

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "VITE_"];

/** Framework mechanics decide exposure: these prefixes ship to clients. */
export const exposureOf = (entry: EnvVarSpec): EnvExposure =>
  PUBLIC_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
    ? "public"
    : "server";

export const primaryOwner = (entry: EnvVarSpec): string =>
  entry.owners[0] ?? "unowned";

export const derivationRule = (entry: EnvVarSpec): string =>
  entry.derivedFrom ?? canonicalFor(entry.name) ?? "supplied";
