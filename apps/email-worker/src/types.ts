/** The Worker's vars and secret (wrangler.jsonc, README.md). */
export interface Env {
  CONVEX_SITE_URL?: string;
  EMAIL_INBOUND_SIGNING_SECRET?: string;
  INBOUND_EMAIL_DOMAIN?: string;
  MAX_BODY_BYTES?: string;
}

/** The parts of Cloudflare's ForwardableEmailMessage this Worker uses. */
export interface InboundMessage {
  readonly from: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array> | string | ArrayBuffer | Uint8Array;
  readonly rawSize: number;
  setReject: (reason: string) => void;
  readonly to: string;
}

/** What the handler reaches outside itself, replaceable in tests. */
export interface Deps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Structured log line: outcomes and counts only, never content. */
  log: (entry: Record<string, unknown>) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}
