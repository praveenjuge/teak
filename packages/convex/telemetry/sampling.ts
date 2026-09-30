import type { NodeOptions } from "@sentry/node";

type TransactionEvent = Parameters<
  NonNullable<NodeOptions["beforeSendTransaction"]>
>[0];

import {
  resolveBackendTraceSampleRate,
  type TelemetryEnvironment,
} from "../shared/telemetry";

const failureStatuses = new Set([
  "internal_error",
  "unknown_error",
  "deadline_exceeded",
  "permission_denied",
  "unauthenticated",
  "unavailable",
  "resource_exhausted",
  "invalid_argument",
  "not_found",
  "aborted",
  "data_loss",
]);

/** Tail sampling preserves a critical child even when its routine parent succeeds. */
export const sampleBackendTransaction = (
  event: TransactionEvent,
  environment: TelemetryEnvironment,
  random = Math.random
): TransactionEvent | null => {
  const spans = [event.contexts?.trace, ...(event.spans ?? [])];
  const rootDuration =
    typeof event.timestamp === "number" &&
    typeof event.start_timestamp === "number"
      ? (event.timestamp - event.start_timestamp) * 1000
      : undefined;
  const rates = spans.map((span) => {
    const data = span?.data ?? {};
    const status = span?.status;
    const duration =
      typeof data["duration.ms"] === "number"
        ? data["duration.ms"]
        : rootDuration;
    let outcome = typeof data.outcome === "string" ? data.outcome : undefined;
    if (status && failureStatuses.has(status)) {
      outcome = "failure";
    }
    return resolveBackendTraceSampleRate({
      durationMs: duration,
      environment,
      name: event.transaction,
      operation: typeof data.operation === "string" ? data.operation : span?.op,
      outcome,
    });
  });
  const rate = Math.max(...rates);
  return rate === 1 || random() < rate ? event : null;
};
