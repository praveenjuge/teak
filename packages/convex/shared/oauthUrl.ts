import { isLocalDevelopmentHostname } from "../devUrls";

export const isLoopbackHostname = (hostname: string): boolean =>
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

export const validateOAuthUrl = (raw: unknown, local = false): URL => {
  if (typeof raw !== "string") {
    throw new Error("Missing OAuth discovery URL");
  }
  const url = new URL(raw);
  // "localhost." is the same host as "localhost".
  const hostname = url.hostname.replace(/\.+$/, "");
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && isLoopbackHostname(hostname))) ||
    (!local && isLoopbackHostname(hostname)) ||
    (privateHost(hostname) && !(local && isLoopbackHostname(hostname)))
  ) {
    throw new Error("Unsafe OAuth discovery URL");
  }
  return url;
};
