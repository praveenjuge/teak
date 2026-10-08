import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";
import { createEmulator } from "@workos/emulate";
import { EMULATOR_ORIGIN, EMULATOR_PORT, emulatorSeed } from "./config";

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
  target: URL,
  request: IncomingMessage,
  body: string | undefined
): Promise<Forwarded> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && name !== "host") {
      headers.set(name, value);
    }
  }
  // Only ever forwards to the emulator on its fixed loopback port.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(target, {
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

export const startEmulator = async () => {
  // Hosted AuthKit asks for the password after the email, and its tokens
  // name api.workos.com as the issuer; the emulator does both when told to.
  const emulator = await createEmulator({
    port: EMULATOR_PORT + 1,
    seed: emulatorSeed,
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
    const path = request.url ?? "/";
    const refreshToken =
      path === "/user_management/authenticate" && body
        ? refreshTokenOf(body, request.headers["content-type"])
        : undefined;
    const replay = refreshToken ? replays.get(refreshToken) : undefined;
    const forwarded =
      replay && replay.expiresAt > Date.now()
        ? replay
        : await forward(new URL(path, emulator.url), request, body);
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
          server.listen(EMULATOR_PORT, host, () => resolve(server));
        })
    )
  );
  return {
    url: EMULATOR_ORIGIN,
    close: async () => {
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await emulator.close();
    },
  };
};
