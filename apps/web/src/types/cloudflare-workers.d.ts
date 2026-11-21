// The Workers runtime APIs the server entry uses. Full runtime types would
// clash with the DOM types the rest of this client-and-server app relies on.
declare module "cloudflare:workers" {
  export const env: {
    // wrangler.jsonc `version_metadata`; optional, so a report never fails on it.
    readonly CF_VERSION_METADATA?: {
      id: string;
      tag: string;
      timestamp: string;
    };
  };
  export function waitUntil(promise: Promise<unknown>): void;
}
