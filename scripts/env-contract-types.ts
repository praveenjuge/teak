export type EnvTarget =
  | "web"
  | "convex"
  | "core-worker"
  | "email-worker"
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
  | "wrangler-secret"
  | "wrangler-var"
  | "cloudflare"
  | "github-secrets"
  | "workflow"
  | "shell"
  | "build"
  | "sdk-implicit"
  | "component-implicit";

export type EnvClassification =
  | "secret"
  | "public-config"
  | "generated"
  | "build-metadata"
  | "platform-binding";

export type EnvExposure = "server" | "public";

export interface EnvVarSpec {
  allowedValues?: string[];
  classification?: EnvClassification;
  derivedFrom?: string;
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
