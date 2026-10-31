import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";
import {
  OAUTH_SURFACES,
  type OAuthSurface,
} from "@teak/convex/shared/oauthSurfaces";
import {
  isLoopbackHostname as loopback,
  validateOAuthUrl,
} from "@teak/convex/shared/oauthUrl";
import {
  PRODUCTION_WORKOS_RESOURCES,
  workosResourcesFor,
} from "@teak/convex/shared/workosResources";

export {
  OAUTH_SURFACES,
  type OAuthSurface,
} from "@teak/convex/shared/oauthSurfaces";
export { validateOAuthUrl } from "@teak/convex/shared/oauthUrl";

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
  // One document from the Teak deployment names the issuer, its endpoints,
  // the clients and the resource. The deployment already chose the issuer, so
  // trusting it for the endpoints too gives it no new reach as long as they
  // sit on the issuer's origin: codes and refresh tokens only ever go there.
  const pending = (async (): Promise<AuthDiscovery> => {
    const document = await read(
      `${site.origin}/.well-known/teak-oauth-clients.json`
    );
    if (document.primary !== "workos") {
      throw new Error("Unknown OAuth provider");
    }
    const issuer = validateUrl(document.issuer);
    if (issuer.search) {
      throw new Error("Invalid OAuth issuer");
    }
    const issuerEndpoint = (raw: unknown) => {
      const url = validateUrl(raw);
      if (url.origin !== issuer.origin) {
        throw new Error("OAuth endpoint is not on the issuer's origin");
      }
      return url.href;
    };
    if (
      !(
        Array.isArray(document.code_challenge_methods_supported) &&
        document.code_challenge_methods_supported.includes("S256")
      )
    ) {
      throw new Error("OAuth server does not support S256 PKCE");
    }
    const clients = object(document.clients);
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
      document.resource !== PRODUCTION_WORKOS_RESOURCES.mcp &&
      document.resource !== workosResourcesFor(site.origin).mcp
    ) {
      throw new Error("OAuth resource mismatch");
    }
    return Object.freeze({
      primary: "workos",
      issuer: document.issuer as string,
      authorizationEndpoint: issuerEndpoint(document.authorization_endpoint),
      tokenEndpoint: issuerEndpoint(document.token_endpoint),
      resource: document.resource as string,
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
