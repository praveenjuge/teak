/**
 * API-local copy of `@teak/convex/shared/metrics` kept in sync by hand.
 *
 * `apps/api` is compiled with `tsc` and runs plain Node in production, so it
 * cannot import the raw `.ts` files that `@teak/convex` ships (see
 * `src/dependencies.test.ts`). Keep the surface of this file behaviourally
 * identical to `packages/convex/shared/metrics.ts`.
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

interface InternalConfig {
  app: TeakApp;
  env: string;
  recorder: MetricsRecorder;
}

const defaultConfig: InternalConfig = {
  app: "api",
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
    console.warn("[metric] recorder failed", error);
  }
}

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
