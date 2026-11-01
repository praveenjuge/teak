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
// Deployments from before the single-document discovery publish none of
// these in teak-oauth-clients.json; they still answer the RFC 9728 and
// RFC 8414 documents, so clients read those from them instead.
const SINGLE_DOCUMENT_FIELDS = [
  "resource",
  "authorization_endpoint",
  "token_endpoint",
  "code_challenge_methods_supported",
] as const;

async function readLegacyServer(
  read: (url: string) => Promise<Record<string, unknown>>,
  site: URL,
  issuer: URL,
  issuerHref: unknown,
  issuerEndpoint: (raw: unknown) => string
) {
  const resource = await read(
    `${site.origin}/.well-known/oauth-protected-resource/mcp`
  );
  const servers = resource.authorization_servers;
  if (!Array.isArray(servers) || servers.length !== 1) {
    throw new Error("Expected one OAuth authorization server");
  }
  if (servers[0] !== issuerHref) {
    throw new Error("OAuth provider configuration changed; retry discovery");
  }
  const metadataUrl = new URL(issuer.origin);
  metadataUrl.pathname = `/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`;
  const metadata = await read(metadataUrl.href);
  if (metadata.issuer !== issuerHref) {
    throw new Error("OAuth issuer mismatch");
  }
  return {
    resource: resource.resource,
    authorizationEndpoint: issuerEndpoint(metadata.authorization_endpoint),
    tokenEndpoint: issuerEndpoint(metadata.token_endpoint),
    codeChallengeMethods: metadata.code_challenge_methods_supported,
  };
}

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
      // A forced refresh asks the server again rather than reuse a copy the
      // browser cached (the documents allow five minutes).
      ...({
        credentials: "omit",
        ...(options.forceRefresh ? { cache: "no-cache" } : {}),
      } as RequestInit),
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
    const server = SINGLE_DOCUMENT_FIELDS.every(
      (field) => document[field] === undefined
    )
      ? await readLegacyServer(
          read,
          site,
          issuer,
          document.issuer,
          issuerEndpoint
        )
      : {
          resource: document.resource,
          authorizationEndpoint: issuerEndpoint(
            document.authorization_endpoint
          ),
          tokenEndpoint: issuerEndpoint(document.token_endpoint),
          codeChallengeMethods: document.code_challenge_methods_supported,
        };
    if (
      !(
        Array.isArray(server.codeChallengeMethods) &&
        server.codeChallengeMethods.includes("S256")
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
      server.resource !== PRODUCTION_WORKOS_RESOURCES.mcp &&
      server.resource !== workosResourcesFor(site.origin).mcp
    ) {
      throw new Error("OAuth resource mismatch");
    }
    return Object.freeze({
      primary: "workos",
      issuer: document.issuer as string,
      authorizationEndpoint: server.authorizationEndpoint,
      tokenEndpoint: server.tokenEndpoint,
      resource: server.resource as string,
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
