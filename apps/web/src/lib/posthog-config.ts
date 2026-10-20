import {
  POSTHOG_ASSETS_HOST,
  POSTHOG_INGEST_HOST,
  POSTHOG_UI_HOST,
} from "@teak/convex/shared/posthog";
import { scrubTelemetryValue } from "@teak/convex/shared/telemetry";
import type { CaptureResult, PostHogConfig } from "posthog-js";

export const POSTHOG_PROXY_PATH = "/ingest";
const POSTHOG_ASSET_PATH_PREFIXES = ["/static/", "/array/"];

export const resolveAnalyticsProxyTarget = (url: URL): URL | null => {
  if (!url.pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) {
    return null;
  }
  const path = url.pathname.slice(POSTHOG_PROXY_PATH.length);
  const host = POSTHOG_ASSET_PATH_PREFIXES.some((prefix) =>
    path.startsWith(prefix)
  )
    ? POSTHOG_ASSETS_HOST
    : POSTHOG_INGEST_HOST;
  return new URL(`${path}${url.search}`, host);
};

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

const INJECTED_GLOBAL_PATTERN = /\bwindow\.videoSniffer\b/u;

// Browsers raise these without a stack: "Script error." hides a cross-origin
// script's real error, and the ResizeObserver loop warning is harmless.
const STACKLESS_BROWSER_NOISE =
  /^(?:Script error\.|ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)\.?)$/u;

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

// Frames arrive before symbolication, so React's frames look like Next
// chunks. Teak code never calls removeChild (scripts/lint/no-remove-child.grit),
// so this error comes from an extension editing the DOM React owns.
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
      (framesOf(entry).length === 0 &&
        STACKLESS_BROWSER_NOISE.test(entry.value ?? "")) ||
      isExternalDomMutation(entry)
  );

// The library search lives in `?q=`. Analytics see that a search ran, never
// what it was: the SDK masks it in `$current_url` and replays, and
// `maskSearchText` covers the referrer properties the SDK leaves alone.
const SEARCH_URL_PARAMS = ["q"];
const MASKED_SEARCH = "<MASKED>";
const URL_PROPERTIES = [
  "$current_url",
  "$initial_current_url",
  "$initial_referrer",
  "$prev_pageview_url",
  "$referrer",
];

const maskSearchParams = (value: unknown): unknown => {
  if (typeof value !== "string" || !value.includes("?")) {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const masked = SEARCH_URL_PARAMS.filter((param) =>
    url.searchParams.has(param)
  );
  if (masked.length === 0) {
    return value;
  }
  for (const param of masked) {
    url.searchParams.set(param, MASKED_SEARCH);
  }
  return url.toString();
};

const maskUrlProperties = (
  properties: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!properties) {
    return properties;
  }
  let changed: Record<string, unknown> | undefined;
  for (const key of URL_PROPERTIES) {
    const masked = maskSearchParams(properties[key]);
    if (masked !== properties[key]) {
      changed ??= { ...properties };
      changed[key] = masked;
    }
  }
  return changed ?? properties;
};

export const maskSearchText = (event: CaptureResult): CaptureResult => {
  const properties = maskUrlProperties(event.properties);
  const $set = maskUrlProperties(event.$set);
  const $set_once = maskUrlProperties(event.$set_once);
  if (
    properties === event.properties &&
    $set === event.$set &&
    $set_once === event.$set_once
  ) {
    return event;
  }
  return {
    ...event,
    properties: properties ?? event.properties,
    ...($set ? { $set } : {}),
    ...($set_once ? { $set_once } : {}),
  };
};

export const filterPostHogEvent = (
  captured: CaptureResult | null
): CaptureResult | null => {
  if (!captured) {
    return captured;
  }
  const event = maskSearchText(captured);
  if (event.event !== "$exception") {
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
  custom_personal_data_properties: SEARCH_URL_PARAMS,
  defaults: "2026-08-30",
  mask_personal_data_properties: true,
  person_profiles: "identified_only",
  persistence: "localStorage+cookie",
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
