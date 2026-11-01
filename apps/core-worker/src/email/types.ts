export interface InboundEmailEnv {
  EMAIL_INBOUND_SIGNING_SECRET?: string;
  INBOUND_EMAIL_DOMAIN?: string;
  MAX_BODY_BYTES?: string;
}

export interface EmailEnv extends InboundEmailEnv {
  CONVEX_SITE_URL?: string;
}

export interface InboundMessage {
  readonly from: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array> | string | ArrayBuffer | Uint8Array;
  readonly rawSize: number;
  setReject: (reason: string) => void;
  readonly to: string;
}

export interface Deps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Structured log line: outcomes and counts only, never content. */
  log: (entry: Record<string, unknown>) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeout: (ms: number) => AbortSignal;
}
