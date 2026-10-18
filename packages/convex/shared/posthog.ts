import {
  ignoreTelemetryError,
  scrubTelemetryString,
  scrubTelemetryValue,
} from "./telemetry";

export const POSTHOG_INGEST_HOST = "https://us.i.posthog.com";
export const POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";
export const POSTHOG_UI_HOST = "https://us.posthog.com";
export const POSTHOG_PROJECT_ID = "660923";

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
  set?: PostHogProperties;
}

export interface PostHogExceptionInput {
  distinctId?: string;
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

const MAX_FRAME_LINE_LENGTH = 2000;

const splitLocation = (
  location: string
): { colno: number; filename: string; lineno: number } | null => {
  const colAt = location.lastIndexOf(":");
  const lineAt = colAt > 0 ? location.lastIndexOf(":", colAt - 1) : -1;
  if (lineAt <= 0) {
    return null;
  }
  const lineno = Number(location.slice(lineAt + 1, colAt));
  const colno = Number(location.slice(colAt + 1));
  if (!(Number.isInteger(lineno) && Number.isInteger(colno))) {
    return null;
  }
  return { colno, filename: location.slice(0, lineAt), lineno };
};

// V8 ("at fn (file:1:2)" or "at file:1:2") and JavaScriptCore/SpiderMonkey
// ("fn@file:1:2") stack lines.
const parseFrameLine = (
  rawLine: string
): { colno: number; filename: string; fn: string; lineno: number } | null => {
  const line = rawLine.trim();
  if (line.length > MAX_FRAME_LINE_LENGTH) {
    return null;
  }
  let fn = "";
  let location: string;
  if (line.startsWith("at ")) {
    const body = line.slice(3);
    const open = body.lastIndexOf(" (");
    if (open !== -1 && body.endsWith(")")) {
      fn = body.slice(0, open);
      location = body.slice(open + 2, -1);
    } else {
      location = body;
    }
  } else {
    const at = line.indexOf("@");
    if (at === -1) {
      return null;
    }
    fn = line.slice(0, at);
    location = line.slice(at + 1);
  }
  const parsed = splitLocation(location);
  return parsed ? { ...parsed, fn: fn.trim() } : null;
};

const isLibraryFile = (file: string) =>
  file.includes("node_modules") ||
  file.startsWith("node:") ||
  file === "native";

export const parseStackFrames = (
  stack: string | undefined,
  platform: string
): StackFrame[] => {
  if (!stack) {
    return [];
  }
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const frame = parseFrameLine(line);
    if (!frame) {
      continue;
    }
    const file = scrubTelemetryString(frame.filename);
    frames.push({
      colno: frame.colno,
      filename: file,
      function: frame.fn || "?",
      in_app: !isLibraryFile(file),
      lineno: frame.lineno,
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
  lib: string;
  libVersion?: string;
  platform?: string;
  timeoutMs?: number;
  token: string | undefined;
}

export interface PostHogBatch {
  capture: (input: PostHogCaptureInput) => void;
  captureException: (error: unknown, input?: PostHogExceptionInput) => void;
  readonly enabled: boolean;
  flush: () => Promise<boolean>;
  readonly size: number;
}

export const createPostHogBatch = (
  options: PostHogBatchOptions
): PostHogBatch => {
  const token = options.token?.trim();
  let host = options.host ?? POSTHOG_INGEST_HOST;
  while (host.endsWith("/")) {
    host = host.slice(0, -1);
  }
  const platform = options.platform ?? "node:javascript";
  const send = options.fetch ?? ((...args) => fetch(...args));
  let queue: PostHogEvent[] = [];

  const enqueue = (input: PostHogCaptureInput, raw?: PostHogProperties) => {
    if (!token) {
      return;
    }
    ignoreTelemetryError(() => {
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
    });
  };

  return {
    capture: (input) => enqueue(input),
    captureException: (error, input = {}) => {
      if (!token) {
        return;
      }
      ignoreTelemetryError(() =>
        enqueue(
          { distinctId: input.distinctId, event: "$exception" },
          buildExceptionProperties(error, {
            handled: input.handled,
            platform,
            properties: input.properties,
          })
        )
      );
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
