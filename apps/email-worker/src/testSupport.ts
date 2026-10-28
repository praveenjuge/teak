import { readFileSync } from "node:fs";
import type { Deps, Env, InboundMessage } from "./types";

// Test helpers: .eml fixtures as Cloudflare would hand them over, and a fake
// network that records every request.

export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** The message's top-level headers, folded lines merged, as a Headers. */
export const headersOf = (eml: string): Headers => {
  const block = eml.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const headers = new Headers();
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return headers;
};

export const messageOf = (
  eml: string,
  envelope: { from?: string; to?: string } = {}
) => {
  const rejections: string[] = [];
  const message: InboundMessage = {
    from: envelope.from ?? "ada.example@gmail.com",
    headers: headersOf(eml),
    raw: eml,
    rawSize: new TextEncoder().encode(eml).byteLength,
    setReject: (reason) => {
      rejections.push(reason);
    },
    to: envelope.to ?? "save@in.teakvault.com",
  };
  return { message, rejections };
};

export const TEST_ENV: Env = {
  CONVEX_SITE_URL: "https://test-deployment.convex.site",
  EMAIL_INBOUND_SIGNING_SECRET: "test-inbound-secret",
  INBOUND_EMAIL_DOMAIN: "in.teakvault.com",
  MAX_BODY_BYTES: "1048576",
};

export interface RecordedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  signal: AbortSignal | null;
  url: string;
}

/**
 * A server that never answers. Like `fetch`, the request ends only when its
 * signal aborts; here every deadline has already passed, so a request with
 * one fails with a TimeoutError and one without it waits forever.
 */
export const hang = (request: RecordedRequest): Promise<Response> =>
  new Promise((_resolve, reject) => {
    if (request.signal) {
      queueMicrotask(() =>
        reject(new DOMException("The operation timed out.", "TimeoutError"))
      );
    }
  });

const recordedBody = (body: RequestInit["body"]): unknown => {
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  return body instanceof Uint8Array ? body : null;
};

/** A fake network: `respond` answers each request, in order. */
export const fakeDeps = (
  respond: (
    request: RecordedRequest,
    nth: number
  ) => Response | Promise<Response>
) => {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const timeouts: number[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: Deps = {
    fetch: async (input, init) => {
      const rawBody = init?.body;
      const request: RecordedRequest = {
        body: recordedBody(rawBody),
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
        signal: init?.signal ?? null,
        url: input,
      };
      requests.push(request);
      return await respond(request, requests.length - 1);
    },
    log: (entry) => {
      logs.push(entry);
    },
    now: () => Date.UTC(2026, 9, 14, 9, 30),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    timeout: (ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
  };
  return { deps, logs, requests, sleeps, timeouts };
};

export const json = (status: number, body: unknown): Response =>
  Response.json(body, { status });
