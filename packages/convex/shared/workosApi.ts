// Where this deployment reaches the WorkOS API. Production always uses
// api.workos.com. A local stack may point at the WorkOS emulator on a loopback
// origin; a hosted deployment cannot reach one, so a misconfigured base fails
// closed instead of trusting emulator tokens.
const PRODUCTION_ORIGIN = "https://api.workos.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const parseWorkosApiBase = (value: string | undefined): URL => {
  if (!value) {
    return new URL(PRODUCTION_ORIGIN);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WORKOS_API_BASE_URL must be a URL.");
  }
  const loopbackEmulator =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (
    !(url.origin === PRODUCTION_ORIGIN || loopbackEmulator) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "WORKOS_API_BASE_URL must be https://api.workos.com or a loopback WorkOS emulator origin."
    );
  }
  return url;
};

// A local Convex backend serves on a loopback origin; hosted ones never do.
export const isLoopbackOrigin = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
};

// Function code may read the optional variable directly; auth config may not.
export const workosApiBase = () =>
  parseWorkosApiBase(process.env.WORKOS_API_BASE_URL);

export const isWorkosProductionApi = (base: URL) =>
  base.origin === PRODUCTION_ORIGIN;

// AuthKit tokens always name api.workos.com as their issuer. The emulator is
// started with `--issuer https://api.workos.com` so this check never branches.
export const workosIssuer = (clientId: string) =>
  `${PRODUCTION_ORIGIN}/user_management/${clientId}`;

export const workosApiUrl = (path: string) => new URL(path, workosApiBase());
