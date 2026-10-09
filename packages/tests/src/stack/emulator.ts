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

interface Forwarded {
  body: string;
  headers: [string, string][];
  status: number;
}

const refreshTokenOf = (body: string, contentType: string | undefined) => {
  try {
    const fields = contentType?.includes("json")
      ? (JSON.parse(body) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(body));
    return fields.grant_type === "refresh_token" &&
      typeof fields.refresh_token === "string"
      ? fields.refresh_token
      : undefined;
  } catch {}
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

// The emulator itself listens on the next port, behind the proxy.
export const startEmulator = async (
  ports: StackPorts,
  options: { devUser: boolean }
) => {
  const upstream = `http://localhost:${ports.emulator + 1}`;
  // Hosted AuthKit asks for the password after the email, and its tokens
  // name api.workos.com as the issuer; the emulator does both when told to.
  const emulator = await createEmulator({
    port: ports.emulator + 1,
    seed: emulatorSeed(ports, options),
    issuer: "https://api.workos.com",
    interactiveAuth: { password: true },
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
  const servers = await Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise<Server>((resolve) => {
          const server = createServer(handle);
          server.listen(ports.emulator, host, () => resolve(server));
        })
    )
  );
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
