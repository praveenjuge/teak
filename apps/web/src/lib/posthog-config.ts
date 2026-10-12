import {
  POSTHOG_ASSETS_HOST,
  POSTHOG_INGEST_HOST,
  POSTHOG_UI_HOST,
} from "@teak/convex/shared/posthog";
import { scrubTelemetryValue } from "@teak/convex/shared/telemetry";
import type { CaptureResult, PostHogConfig } from "posthog-js";

/** Same-origin reverse proxy to PostHog (src/proxy.ts). */
export const POSTHOG_PROXY_PATH = "/ingest";

/**
 * Where a `/ingest/...` request goes: SDK scripts and remote config come from
 * the assets host, everything else from the ingestion host. Null for any
 * other path.
 */
export const resolveAnalyticsProxyTarget = (url: URL): URL | null => {
  if (!url.pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) {
    return null;
  }
  const path = url.pathname.slice(POSTHOG_PROXY_PATH.length);
  const host =
    path.startsWith("/static/") || path.startsWith("/array/")
      ? POSTHOG_ASSETS_HOST
      : POSTHOG_INGEST_HOST;
  return new URL(`${path}${url.search}`, host);
};

/**
 * Only production deployments report. Developers often pull Vercel env vars
 * into .env.local, and a production token there must not turn local crashes
 * and clicks into production data, so the Vercel environment decides.
 */
export const resolvePostHogToken = (env: {
  token?: string;
  vercelEnvironment?: string;
}): string | undefined =>
  env.vercelEnvironment === "production"
    ? env.token?.trim() || undefined
    : undefined;

interface ExceptionFrame {
  filename?: string;
}

interface ExceptionEntry {
  stacktrace?: { frames?: ExceptionFrame[] };
  type?: string;
  value?: string;
}

const INJECTED_FRAME_PREFIXES = [
  "app:///build/backendManager.js",
  "app:///inject-net.js",
  "app:///scripts/",
  "app:///userscript",
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
];

// Globals that in-app browsers and video downloaders inject into the page.
const INJECTED_GLOBAL_PATTERN = /\bwindow\.videoSniffer\b/u;

const REMOVE_CHILD_MESSAGE =
  "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.";

const framesOf = (entry: ExceptionEntry) => entry.stacktrace?.frames ?? [];

const isExtensionFrame = ({ filename }: ExceptionFrame) =>
  Boolean(
    filename &&
      INJECTED_FRAME_PREFIXES.some((prefix) => filename.startsWith(prefix))
  );

const isReactOrBundledFrame = ({ filename }: ExceptionFrame) =>
  Boolean(
    filename &&
      (filename.includes("/react-dom/") ||
        filename.includes("/scheduler/") ||
        filename.includes("/_next/static/chunks/") ||
        filename.includes("/_next/static/immutable/chunks/"))
  );

// Frames arrive before symbolication, so production React frames look like
// bundled Next chunks. Teak's only manual removeChild is a download link it
// just appended (useCardModal), so a removeChild NotFoundError raised only
// from framework frames comes from an extension mutating the DOM.
const isExternalDomMutation = (entry: ExceptionEntry) =>
  entry.type === "NotFoundError" &&
  entry.value === REMOVE_CHILD_MESSAGE &&
  framesOf(entry).length > 0 &&
  framesOf(entry).every(isReactOrBundledFrame);

export const isNoiseException = (entries: ExceptionEntry[]): boolean =>
  entries.some(
    (entry) =>
      framesOf(entry).some(isExtensionFrame) ||
      INJECTED_GLOBAL_PATTERN.test(entry.value ?? "") ||
      isExternalDomMutation(entry)
  );

/** Drops extension and injected-script noise and scrubs exception text. */
export const filterPostHogEvent = (
  event: CaptureResult | null
): CaptureResult | null => {
  if (event?.event !== "$exception") {
    return event;
  }
  const entries = event.properties.$exception_list;
  if (!Array.isArray(entries)) {
    return event;
  }
  if (isNoiseException(entries as ExceptionEntry[])) {
    return null;
  }
  return {
    ...event,
    properties: {
      ...event.properties,
      $exception_list: scrubTelemetryValue(entries),
    },
  };
};

// Teak uses no feature flags, but the /flags response still carries the
// feedback survey's targeting, so it stays on (after the deferred load).
export const buildPostHogOptions = (): Partial<PostHogConfig> => ({
  api_host: POSTHOG_PROXY_PATH,
  autocapture: false,
  before_send: filterPostHogEvent,
  capture_dead_clicks: false,
  capture_exceptions: true,
  capture_heatmaps: false,
  capture_pageview: "history_change",
  capture_performance: { network_timing: false, web_vitals: true },
  defaults: "2026-08-30",
  person_profiles: "identified_only",
  persistence: "localStorage+cookie",
  // Sampling (10% plus sessions with an exception) lives in project settings.
  session_recording: {
    blockSelector: "img, picture, video, audio, canvas, iframe",
    captureJsonLd: false,
    maskAllInputs: true,
    maskTextSelector: "*",
    recordBody: false,
    recordHeaders: false,
  },
  ui_host: POSTHOG_UI_HOST,
});
