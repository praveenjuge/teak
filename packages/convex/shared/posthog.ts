import { scrubTelemetryString, scrubTelemetryValue } from "./telemetry";

/**
 * Dependency-free PostHog capture for surfaces that must not load an SDK:
 * Convex functions, the files worker, the browser extension, and Next.js
 * server hooks. Pure on purpose: no Node, DOM, or Convex runtime imports.
 */

export const POSTHOG_INGEST_HOST = "https://us.i.posthog.com";
export const POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";
export const POSTHOG_UI_HOST = "https://us.posthog.com";

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_FRAMES = 50;
const MAX_CAUSES = 3;
// The unknown-user id for server errors with no signed-in owner. Events sent
// with it skip person processing so they never create a fake person.
const ANONYMOUS_DISTINCT_ID = "teak-anonymous";

export type PostHogProperties = Record<string, unknown>;

export interface PostHogEvent {
  distinct_id: string;
  event: string;
  properties: PostHogProperties;
  timestamp: string;
}

export interface PostHogCaptureInput {
  distinctId?: string;
  event: string;
  properties?: PostHogProperties;
  /** Person properties, sent unscrubbed: they carry the account email. */
  set?: PostHogProperties;
}

export interface PostHogExceptionInput {
  distinctId?: string;
  /** Whether the app caught the error itself (true) or it escaped (false). */
  handled?: boolean;
  properties?: PostHogProperties;
}

interface StackFrame {
  colno?: number;
  filename?: string;
  function: string;
  in_app: boolean;
  lineno?: number;
  platform: string;
}

// V8 ("    at fn (file:1:2)" or "    at file:1:2") and
// JavaScriptCore/SpiderMonkey ("fn@file:1:2") stack lines.
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/u;
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/u;

export const parseStackFrames = (
  stack: string | undefined,
  platform: string
): StackFrame[] => {
  if (!stack) {
    return [];
  }
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!match) {
      continue;
    }
    const [, fn, filename, lineno, colno] = match;
    const file = scrubTelemetryString(filename ?? "");
    frames.push({
      colno: Number(colno),
      filename: file,
      function: fn?.trim() || "?",
      in_app: !/node_modules|^node:|^native$/u.test(file),
      lineno: Number(lineno),
      platform,
    });
    if (frames.length >= MAX_FRAMES) {
      break;
    }
  }
  // PostHog, like Sentry, lists the crashing frame last.
  return frames.reverse();
};

const describeError = (
  error: unknown
): { stack?: string; type: string; value: string } => {
  if (error instanceof Error) {
    return {
      stack: error.stack,
      type: error.name || "Error",
      value: error.message,
    };
  }
  if (typeof error === "string") {
    return { type: "Error", value: error };
  }
  try {
    return { type: "Error", value: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: "Error", value: String(error) };
  }
};

export const buildExceptionProperties = (
  error: unknown,
  options: {
    handled?: boolean;
    platform: string;
    properties?: PostHogProperties;
  }
): PostHogProperties => {
  const exceptions: PostHogProperties[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth <= MAX_CAUSES; depth++) {
    const { stack, type, value } = describeError(current);
    const frames = parseStackFrames(stack, options.platform);
    exceptions.push({
      mechanism: {
        handled: options.handled ?? true,
        synthetic: !(current instanceof Error),
        type: depth === 0 ? "generic" : "chained",
      },
      type,
      value: scrubTelemetryString(value),
      ...(frames.length > 0 ? { stacktrace: { frames, type: "raw" } } : {}),
    });
    current =
      current instanceof Error
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return {
    ...(scrubTelemetryValue(options.properties ?? {}) as PostHogProperties),
    $exception_level: "error",
    $exception_list: exceptions,
  };
};

export interface PostHogBatchOptions {
  fetch?: typeof fetch;
  host?: string;
  /** Sent as `$lib` so dashboards can split events by surface. */
  lib: string;
  libVersion?: string;
  /** Stack frame platform, for example `node:javascript` or `web:javascript`. */
  platform?: string;
  timeoutMs?: number;
  token: string | undefined;
}

export interface PostHogBatch {
  capture: (input: PostHogCaptureInput) => void;
  captureException: (error: unknown, input?: PostHogExceptionInput) => void;
  readonly enabled: boolean;
  /** Sends every queued event in one request. Never throws. */
  flush: () => Promise<boolean>;
  readonly size: number;
}

/**
 * Queues events and sends them as one `/batch/` request per unit of work.
 * Without a token every call is a no-op and nothing is ever fetched.
 */
export const createPostHogBatch = (
  options: PostHogBatchOptions
): PostHogBatch => {
  const token = options.token?.trim();
  const host = (options.host ?? POSTHOG_INGEST_HOST).replace(/\/+$/u, "");
  const platform = options.platform ?? "node:javascript";
  const send = options.fetch ?? ((...args) => fetch(...args));
  let queue: PostHogEvent[] = [];

  const enqueue = (input: PostHogCaptureInput, raw?: PostHogProperties) => {
    if (!token) {
      return;
    }
    try {
      const distinctId = input.distinctId || ANONYMOUS_DISTINCT_ID;
      queue.push({
        distinct_id: distinctId,
        event: input.event,
        properties: {
          ...(raw ??
            (scrubTelemetryValue(input.properties ?? {}) as PostHogProperties)),
          $lib: options.lib,
          ...(options.libVersion ? { $lib_version: options.libVersion } : {}),
          ...(input.distinctId ? {} : { $process_person_profile: false }),
          ...(input.set ? { $set: input.set } : {}),
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Telemetry must never alter product behavior.
    }
  };

  return {
    capture: (input) => enqueue(input),
    captureException: (error, input = {}) => {
      if (!token) {
        return;
      }
      try {
        enqueue(
          { distinctId: input.distinctId, event: "$exception" },
          buildExceptionProperties(error, {
            handled: input.handled,
            platform,
            properties: input.properties,
          })
        );
      } catch {
        // Telemetry must never alter product behavior.
      }
    },
    get enabled() {
      return Boolean(token);
    },
    flush: async () => {
      if (!token || queue.length === 0) {
        return false;
      }
      const batch = queue;
      queue = [];
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );
      try {
        const response = await send(`${host}/batch/`, {
          body: JSON.stringify({ api_key: token, batch }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    get size() {
      return queue.length;
    },
  };
};
