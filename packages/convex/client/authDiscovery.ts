import { isLocalDevelopmentHostname } from "../devUrls";
import { readResponseTextWithinLimit } from "../shared/boundedResponse";

export const OAUTH_SURFACES = [
  "cli",
  "raycast",
  "chrome",
  "firefox",
  "safari",
] as const;
export type OAuthSurface = (typeof OAUTH_SURFACES)[number];
export interface AuthDiscovery {
  readonly authorizationEndpoint: string;
  readonly clients: Readonly<Record<OAuthSurface, string>>;
  readonly issuer: string;
  readonly primary: "betterauth" | "workos";
  readonly resource: string;
  readonly revocationEndpoint?: string;
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
const loopback = (hostname: string) =>
  isLocalDevelopmentHostname(hostname) || hostname === "[::1]";

const privateHost = (hostname: string) => {
  const octets = hostname.split(".").map(Number);
  return (
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.startsWith("[") ||
    (octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (octets[0] === 0 ||
        octets[0] === 10 ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)))
  );
};

const safeUrl = (raw: unknown, local: boolean): URL => {
  if (typeof raw !== "string") {
    throw new Error("Missing OAuth discovery URL");
  }
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && loopback(url.hostname))) ||
    (privateHost(url.hostname) && !(local && loopback(url.hostname)))
  ) {
    throw new Error("Unsafe OAuth discovery URL");
  }
  return url;
};

// Cache is scoped to the deployment and transport. Call with forceRefresh after
// sign-in/refresh failures so a provider flip needs no client release.
export function discoverAuthServer(
  siteUrl: string,
  options: {
    fetch?: typeof fetch;
    forceRefresh?: boolean;
    localIssuer?: string;
    timeoutMs?: number;
  } = {}
): Promise<AuthDiscovery> {
  const site = safeUrl(siteUrl, true);
  const siteIsLocal = loopback(site.hostname);
  const permittedLocalIssuer =
    options.localIssuer === undefined
      ? undefined
      : safeUrl(options.localIssuer, true);
  if (permittedLocalIssuer && !loopback(permittedLocalIssuer.hostname)) {
    throw new Error("Development issuer must use loopback");
  }
  const local = siteIsLocal || permittedLocalIssuer !== undefined;
  const validateUrl = (raw: unknown) => {
    const url = safeUrl(raw, local);
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
      credentials: "omit",
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
    if (
      clientDocument.primary !== "betterauth" &&
      clientDocument.primary !== "workos"
    ) {
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
    if (resource.resource !== `${site.origin}/mcp`) {
      throw new Error("OAuth resource mismatch");
    }
    return Object.freeze({
      primary: clientDocument.primary,
      issuer: servers[0] as string,
      authorizationEndpoint: validateUrl(metadata.authorization_endpoint).href,
      tokenEndpoint: validateUrl(metadata.token_endpoint).href,
      ...(metadata.revocation_endpoint === undefined
        ? {}
        : {
            revocationEndpoint: validateUrl(metadata.revocation_endpoint).href,
          }),
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
    // A failed older request must not evict a newer forced refresh.
    if (cache.get(cacheKey) === entry) {
      cache.delete(cacheKey);
    }
  });
  return pending;
}
