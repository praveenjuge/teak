// The bindings come from wrangler.jsonc through the generated
// worker-configuration.d.ts (`bun run cf-typegen`). It is generated without
// the runtime types, which would clash with the DOM types this
// client-and-server app relies on, so the few runtime APIs the server entry
// uses are declared here.
declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
  export function waitUntil(promise: Promise<unknown>): void;
}

interface WorkerVersionMetadata {
  readonly id: string;
  readonly tag: string;
  readonly timestamp: string;
}
