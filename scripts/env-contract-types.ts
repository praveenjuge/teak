/**
 * Environment contract types and entry builder.
 *
 * Shared by the entry tables in ./env-contract-entries-*.ts. Names and
 * metadata only - never values.
 */

export type EnvTarget =
  | "web"
  | "convex"
  | "files-worker"
  | "desktop"
  | "mobile"
  | "extension"
  | "cli"
  | "raycast"
  | "docs"
  | "e2e"
  | "release"
  | "repo";

export type EnvProfile = "local" | "preview" | "production" | "e2e";

export type EnvValidation =
  | "url"
  | "origin"
  | "email"
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "sha"
  | "path";

export type EnvProvider =
  | "dotenv-local"
  | "convex-dashboard"
  | "vercel"
  | "eas"
  | "wrangler-secret"
  | "wrangler-var"
  | "cloudflare"
  | "github-secrets"
  | "workflow"
  | "shell"
  | "build"
  | "sdk-implicit"
  | "component-implicit";

export interface EnvVarSpec {
  allowedValues?: string[];
  /** Read by an SDK or Convex component without a direct code reference. */
  implicit?: boolean;
  kind?: "env" | "binding";
  name: string;
  note?: string;
  owners: string[];
  profiles: EnvProfile[];
  providers: EnvProvider[];
  required: boolean;
  requiredIn?: EnvProfile[];
  secret: boolean;
  targets: EnvTarget[];
  validation: EnvValidation;
}

export const spec = (
  name: string,
  partial: Omit<EnvVarSpec, "name">
): EnvVarSpec => ({ name, ...partial });
