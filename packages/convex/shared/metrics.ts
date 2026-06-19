/**
 * Shared metrics helpers for Teak.
 *
 * This module exposes a small, SDK-agnostic surface that any app (web, mobile,
 * desktop, extension, API, Convex actions) can call. Host apps wire in a
 * concrete recorder via `configureMetrics` at startup. Sentry's Application
 * Metrics API is the intended primary backend, but anything implementing the
 * `MetricsRecorder` interface works (datadog, statsd, otel, custom log
 * shipper, etc.).
 *
 * Design goals:
 * - Zero runtime coupling to `@sentry/*` so this file can be imported from
 *   Convex actions and pure utility code.
 * - Safe default behaviour: a `console.info` logger that prefixes
 *   `[metric]` so Sentry's `consoleLoggingIntegration` picks the events up as
 *   logs when a proper metrics recorder is not configured.
 * - Consistent tag shape (`app`, `env`, plus domain-specific attributes).
 *
 * Usage:
 *
 * ```ts
 * import { configureMetrics, trackCardCreated } from "@teak/convex/shared/metrics";
 *
 * configureMetrics({
 *   app: "web",
 *   env: process.env.NODE_ENV,
 *   recorder: {
 *     count: (name, value, attributes) =>
 *       Sentry.metrics.count(name, value, { attributes }),
 *     gauge: (name, value, attributes, unit) =>
 *       Sentry.metrics.gauge(name, value, { attributes, unit }),
 *     distribution: (name, value, attributes, unit) =>
 *       Sentry.metrics.distribution(name, value, { attributes, unit }),
 *   },
 * });
 *
 * trackCardCreated({ cardType: "link", source: "web" });
 * ```
 */

export type MetricAttributeValue = string | number | boolean | undefined | null;

export type MetricAttributes = Record<string, MetricAttributeValue>;

export type MetricUnit =
  | "millisecond"
  | "second"
  | "byte"
  | "kilobyte"
  | "megabyte"
  | "none";

export type TeakApp =
  | "web"
  | "mobile"
  | "desktop"
  | "extension"
  | "raycast"
  | "api"
  | "convex"
  | "docs";

export interface MetricsRecorder {
  count: (name: string, value: number, attributes: MetricAttributes) => void;
  distribution: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: MetricUnit
  ) => void;
  gauge: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: MetricUnit
  ) => void;
}

export interface MetricsConfig {
  app?: TeakApp;
  env?: string;
  recorder?: MetricsRecorder;
}

// ---------------------------------------------------------------------------
// Default (console) recorder.
// Emits structured entries so log shippers can parse them. Sentry's
// consoleLoggingIntegration will forward these as logs when a real metrics
// recorder is not configured.
// ---------------------------------------------------------------------------

const consoleRecorder: MetricsRecorder = {
  count(name, value, attributes) {
    console.info(`[metric] count ${name}`, { value, attributes });
  },
  gauge(name, value, attributes, unit) {
    console.info(`[metric] gauge ${name}`, { value, unit, attributes });
  },
  distribution(name, value, attributes, unit) {
    console.info(`[metric] distribution ${name}`, {
      value,
      unit,
      attributes,
    });
  },
};

// ---------------------------------------------------------------------------
// Module-level config
// ---------------------------------------------------------------------------

interface InternalConfig {
  app: TeakApp;
  env: string;
  recorder: MetricsRecorder;
}

const defaultConfig: InternalConfig = {
  app: "convex",
  env: "development",
  recorder: consoleRecorder,
};

let activeConfig: InternalConfig = defaultConfig;

export function configureMetrics(config: MetricsConfig): void {
  activeConfig = {
    app: config.app ?? activeConfig.app,
    env: config.env ?? activeConfig.env,
    recorder: config.recorder ?? activeConfig.recorder,
  };
}

/**
 * Reset configuration to the defaults. Intended for tests and hot reload.
 */
export function resetMetricsConfig(): void {
  activeConfig = defaultConfig;
}

function withBaseAttributes(attributes?: MetricAttributes): MetricAttributes {
  return {
    app: activeConfig.app,
    env: activeConfig.env,
    ...(attributes ?? {}),
  };
}

function safeRecord(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    // Never let metrics take down a request.
    console.warn("[metric] recorder failed", error);
  }
}

// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------

export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes
): void {
  safeRecord(() => {
    activeConfig.recorder.count(name, value, withBaseAttributes(attributes));
  });
}

export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  unit?: MetricUnit
): void {
  safeRecord(() => {
    activeConfig.recorder.gauge(
      name,
      value,
      withBaseAttributes(attributes),
      unit
    );
  });
}

export function distribution(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  unit?: MetricUnit
): void {
  safeRecord(() => {
    activeConfig.recorder.distribution(
      name,
      value,
      withBaseAttributes(attributes),
      unit
    );
  });
}

/**
 * Measure the duration of an async function and emit a distribution metric.
 * Always resolves (or re-throws) with the original value; timing is emitted in
 * both success and failure paths, tagged `outcome=ok|error`.
 */
export async function timedAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: MetricAttributes
): Promise<T> {
  const start = nowMs();
  try {
    const result = await fn();
    distribution(
      name,
      nowMs() - start,
      { ...(attributes ?? {}), outcome: "ok" },
      "millisecond"
    );
    return result;
  } catch (error) {
    distribution(
      name,
      nowMs() - start,
      {
        ...(attributes ?? {}),
        outcome: "error",
        errorClass: classifyError(error),
      },
      "millisecond"
    );
    throw error;
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && performance?.now) {
    return performance.now();
  }
  return Date.now();
}

function classifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }
  if (typeof error === "string") {
    return "StringError";
  }
  return "UnknownError";
}

// ---------------------------------------------------------------------------
// Domain helpers – keep cardinality low and names stable.
// ---------------------------------------------------------------------------

export type CardCreationSource =
  | "web"
  | "mobile"
  | "desktop"
  | "extension"
  | "raycast"
  | "api"
  | "mcp"
  | "share_intent"
  | "drag_drop"
  | "import"
  | "paste"
  | "unknown";

export function trackCardCreated(params: {
  cardType: string;
  source: CardCreationSource;
  via?: string;
}): void {
  counter("card.created", 1, {
    cardType: params.cardType,
    source: params.source,
    via: params.via ?? null,
  });
}

export type AiPipelineStage =
  | "classification"
  | "categorization"
  | "metadata"
  | "renderables"
  | "linkMetadata"
  | "palette";

export type AiStageOutcome = "ok" | "error" | "skipped";

export function trackAiStage(params: {
  stage: AiPipelineStage;
  durationMs: number;
  outcome: AiStageOutcome;
  cardType?: string;
  errorClass?: string;
}): void {
  distribution(
    "card.pipeline.stage.duration",
    params.durationMs,
    {
      stage: params.stage,
      outcome: params.outcome,
      cardType: params.cardType ?? null,
      errorClass: params.errorClass ?? null,
    },
    "millisecond"
  );

  if (params.outcome === "error") {
    counter("card.pipeline.stage.failures", 1, {
      stage: params.stage,
      cardType: params.cardType ?? null,
      errorClass: params.errorClass ?? null,
    });
  }
}

export function trackMcpToolInvocation(params: {
  tool: string;
  outcome: "ok" | "error" | "unauthorized";
  durationMs: number;
  status?: number;
}): void {
  counter("api.mcp.tool.invocations", 1, {
    tool: params.tool,
    outcome: params.outcome,
    status: params.status ?? null,
  });
  distribution(
    "api.mcp.tool.latency",
    params.durationMs,
    {
      tool: params.tool,
      outcome: params.outcome,
    },
    "millisecond"
  );
}
