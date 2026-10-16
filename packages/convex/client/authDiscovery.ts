import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import {
  isLoopbackHostname as loopback,
  validateOAuthUrl,
} from "../shared/oauthUrl";
import {
  PRODUCTION_WORKOS_RESOURCES,
  workosResourcesFor,
} from "../shared/workosResources";

export { validateOAuthUrl } from "../shared/oauthUrl";

export const OAUTH_SURFACES = ["cli", "raycast", "chrome", "firefox"] as const;
export type OAuthSurface = (typeof OAUTH_SURFACES)[number];
export interface AuthDiscovery {
  readonly authorizationEndpoint: string;
  readonly clients: Readonly<Record<OAuthSurface, string>>;
  readonly issuer: string;
  readonly primary: "workos";
  readonly resource: string;
  readonly tokenEndpoint: string;
}

const caches = new WeakMap<
  typeof fetch,
  Map<
    string,
    {
      expiresAt: number;
      pending: Promise<AuthDiscovery>;
    }
  >
>();
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid OAuth discovery document");
  }
  return value as Record<string, unknown>;
};
// Cache is scoped to the deployment and transport. Call with forceRefresh after
// sign-in/refresh failures so a client registration change needs no release.
export function discoverAuthServer(
  siteUrl: string,
  options: {
    fetch?: typeof fetch;
    forceRefresh?: boolean;
    localIssuer?: string;
    timeoutMs?: number;
  } = {}
): Promise<AuthDiscovery> {
  const site = validateOAuthUrl(siteUrl, true);
  const siteIsLocal = loopback(site.hostname);
  const permittedLocalIssuer =
    options.localIssuer === undefined
      ? undefined
      : validateOAuthUrl(options.localIssuer, true);
  if (permittedLocalIssuer && !loopback(permittedLocalIssuer.hostname)) {
    throw new Error("Development issuer must use loopback");
  }
  const local = siteIsLocal || permittedLocalIssuer !== undefined;
  const validateUrl = (raw: unknown) => {
    const url = validateOAuthUrl(raw, local);
    if (
      loopback(url.hostname) &&
      !siteIsLocal &&
      url.origin !== permittedLocalIssuer?.origin
    ) {
      throw new Error("Unapproved loopback OAuth server");
    }
    return url;
  };
  const cacheKey = `${site.origin}|${permittedLocalIssuer?.href ?? ""}`;
  const fetchImpl = options.fetch ?? fetch;
  let cache = caches.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    caches.set(fetchImpl, cache);
  }
  const previous = cache.get(cacheKey);
  if (!options.forceRefresh && previous && previous.expiresAt > Date.now()) {
    return previous.pending;
  }
  if (cache.size >= 16 && !cache.has(cacheKey)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000
  );
  const read = async (url: string) => {
    const response = await fetchImpl(url, {
      method: "GET",
      // A plain RequestInit field; spread so Worker typings, which omit it, accept it.
      ...({ credentials: "omit" } as RequestInit),
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("OAuth discovery request failed");
    }
    const text = await readResponseTextWithinLimit(response, 64 * 1024);
    if (text === null) {
      throw new Error("OAuth discovery document is too large");
    }
    return object(JSON.parse(text));
  };
  const pending = (async (): Promise<AuthDiscovery> => {
    const [resource, clientDocument] = await Promise.all([
      read(`${site.origin}/.well-known/oauth-protected-resource/mcp`),
      read(`${site.origin}/.well-known/teak-oauth-clients.json`),
    ]);
    const servers = resource.authorization_servers;
    if (!Array.isArray(servers) || servers.length !== 1) {
      throw new Error("Expected one OAuth authorization server");
    }
    const issuer = validateUrl(servers[0]);
    if (issuer.search || clientDocument.issuer !== servers[0]) {
      throw new Error("OAuth provider configuration changed; retry discovery");
    }
    const metadataUrl = new URL(issuer.origin);
    metadataUrl.pathname = `/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`;
    const metadata = await read(metadataUrl.href);
    if (metadata.issuer !== servers[0]) {
      throw new Error("OAuth issuer mismatch");
    }
    if (clientDocument.primary !== "workos") {
      throw new Error("Unknown OAuth provider");
    }
    if (
      !(
        Array.isArray(metadata.code_challenge_methods_supported) &&
        metadata.code_challenge_methods_supported.includes("S256")
      )
    ) {
      throw new Error("OAuth server does not support S256 PKCE");
    }
    const clients = object(clientDocument.clients);
    for (const surface of OAUTH_SURFACES) {
      if (
        typeof clients[surface] !== "string" ||
        !(clients[surface] as string).trim()
      ) {
        throw new Error("Missing OAuth client registration");
      }
    }
    // The production resource, or this deployment's own (RFC 9728): never a
    // third party's audience.
    if (
      resource.resource !== PRODUCTION_WORKOS_RESOURCES.mcp &&
      resource.resource !== workosResourcesFor(site.origin).mcp
    ) {
      throw new Error("OAuth resource mismatch");
    }
    return Object.freeze({
      primary: "workos",
      issuer: servers[0] as string,
      authorizationEndpoint: validateUrl(metadata.authorization_endpoint).href,
      tokenEndpoint: validateUrl(metadata.token_endpoint).href,
      resource: resource.resource as string,
      clients: Object.freeze(
        Object.fromEntries(
          OAUTH_SURFACES.map((surface) => [surface, clients[surface]])
        ) as Record<OAuthSurface, string>
      ),
    });
  })().finally(() => {
    controller.abort();
    clearTimeout(timeout);
  });
  const entry = { expiresAt: Date.now() + 60_000, pending };
  cache.set(cacheKey, entry);
  void pending.catch(() => {
    if (cache.get(cacheKey) === entry) {
      cache.delete(cacheKey);
    }
  });
  return pending;
}
