import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";
import { createEmulator } from "@workos/emulate";
import { emulatorSeed, type StackPorts, stackUrls } from "./config";

// Hosted AuthKit treats a refresh token as single use, but replaying it
// within 30 seconds returns the same rotated tokens, so a refresh the browser
// abandoned mid-navigation doesn't end the session
// (https://workos.com/docs/authkit/session-resilience). The emulator rotates
// with no grace window, so a small proxy in front of it adds production's.
const REFRESH_GRACE_MS = 30_000;
const APPLE_APP_REDIRECT_URI = "teak://auth/callback";

interface Forwarded {
  body: string;
  headers: [string, string][];
  status: number;
}

const formFields = (
  body: string,
  contentType: string | undefined
): Record<string, unknown> => {
  if (!contentType?.includes("json")) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const refreshTokenOf = (body: string, contentType: string | undefined) => {
  const fields = formFields(body, contentType);
  return fields.grant_type === "refresh_token" &&
    typeof fields.refresh_token === "string"
    ? fields.refresh_token
    : undefined;
};

const forward = async (
  upstream: string,
  path: string,
  request: IncomingMessage,
  body: string | undefined
): Promise<Forwarded> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && name !== "host") {
      headers.set(name, value);
    }
  }
  // Only the path and query come from the request; the origin is fixed.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(`${upstream}${path}`, {
    body,
    headers,
    method: request.method,
    redirect: "manual",
  });
  return {
    body: await response.text(),
    // fetch already decoded the body, and node:http sets its length.
    headers: [...response.headers].filter(
      ([name]) => !["content-encoding", "content-length"].includes(name)
    ),
    status: response.status,
  };
};

export const startEmulator = async (ports: StackPorts) => {
  const upstream = `http://localhost:${ports.emulatorUpstream}`;
  // Hosted AuthKit asks for the password after the email, and its tokens
  // name api.workos.com as the issuer; the emulator does both when told to.
  const emulator = await createEmulator({
    port: ports.emulatorUpstream,
    seed: emulatorSeed(ports),
    issuer: "https://api.workos.com",
    interactiveAuth: { password: true },
    allowedRedirectHosts: [new URL(APPLE_APP_REDIRECT_URI).host],
  });
  const replays = new Map<string, Forwarded & { expiresAt: number }>();
  // node:http rather than Bun.serve: the emulator's Hono adapter replaces the
  // global Response, which Bun.serve then rejects.
  const handle: RequestListener = async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
    // Keep only the path and query, even for an absolute-form request target.
    const incoming = new URL(request.url ?? "/", upstream);
    const path = `${incoming.pathname}${incoming.search}`;
    const refreshToken =
      incoming.pathname === "/user_management/authenticate" && body
        ? refreshTokenOf(body, request.headers["content-type"])
        : undefined;
    const replay = refreshToken ? replays.get(refreshToken) : undefined;
    const forwarded =
      replay && replay.expiresAt > Date.now()
        ? replay
        : await forward(upstream, path, request, body);
    if (refreshToken && !replay && forwarded.status === 200) {
      replays.set(refreshToken, {
        ...forwarded,
        expiresAt: Date.now() + REFRESH_GRACE_MS,
      });
    }
    response.writeHead(forwarded.status, forwarded.headers);
    response.end(forwarded.body);
  };
  // `localhost` resolves to either loopback address depending on the client.
  // Hosts without IPv6 (cloud VMs) only get the IPv4 listener.
  const servers = (
    await Promise.all(
      ["127.0.0.1", "::1"].map(
        (host) =>
          new Promise<Server | null>((resolve, reject) => {
            const server = createServer(handle);
            server.once("error", (error: NodeJS.ErrnoException) => {
              if (host === "::1" && error.code === "EAFNOSUPPORT") {
                resolve(null);
                return;
              }
              reject(error);
            });
            server.listen(ports.emulator, host, () => resolve(server));
          })
      )
    )
  ).filter((server): server is Server => server !== null);
  return {
    url: stackUrls(ports).emulatorOrigin,
    close: async () => {
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await emulator.close();
    },
  };
};
