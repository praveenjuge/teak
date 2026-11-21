// The one Workers runtime API the server entry uses. Full runtime types would
// clash with the DOM types the rest of this client-and-server app relies on.
declare module "cloudflare:workers" {
  export function waitUntil(promise: Promise<unknown>): void;
}
