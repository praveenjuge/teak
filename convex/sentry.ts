/**
 * Sentry Integration for Convex
 *
 * Provides error tracking, tracing, and structured logging for Convex functions.
 * Uses @sentry/node for server-side instrumentation.
 */

import * as Sentry from "@sentry/node";

// Initialize Sentry for Convex functions
Sentry.init({
  dsn: "https://4c7f2a2736f679ddd80b4375fc3eebfc@o4509483678236672.ingest.us.sentry.io/4510434869182464",

  // Define how likely traces are sampled
  tracesSampleRate: 1.0,

  // Enable structured logs
  enableLogs: true,

  // Send user PII for better debugging
  sendDefaultPii: true,

  // Set environment based on Convex environment
  environment: process.env.SITE_URL?.includes("localhost")
    ? "development"
    : "production",

  integrations: [
    // Send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration(),
  ],
});

// Re-export Sentry for use in other modules
export { Sentry };

// Export the logger for structured logging
export const { logger } = Sentry;

/**
 * Wrap a Convex action/mutation handler with Sentry error tracking and tracing
 *
 * @param name - The name of the operation for tracing
 * @param op - The operation type (e.g., "convex.action", "convex.mutation", "convex.query")
 * @param handler - The handler function to wrap
 * @returns A wrapped handler with Sentry instrumentation
 */
export function withSentry<TArgs, TResult>(
  name: string,
  op: string,
  handler: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    return Sentry.startSpan(
      {
        op,
        name,
      },
      async (span) => {
        try {
          const result = await handler(args);
          span.setStatus({ code: 1 }); // OK
          return result;
        } catch (error) {
          span.setStatus({ code: 2, message: "error" }); // ERROR
          Sentry.captureException(error);
          throw error;
        }
      }
    );
  };
}

/**
 * Capture an exception and log it to Sentry
 *
 * @param error - The error to capture
 * @param context - Optional context to attach to the error
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext("additional", context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Start a span for measuring performance of an operation
 *
 * @param op - The operation type (e.g., "ai.classify", "workflow.step")
 * @param name - The name of the operation
 * @param callback - The callback to execute within the span
 * @returns The result of the callback
 */
export async function startSpan<T>(
  op: string,
  name: string,
  callback: (span: Sentry.Span) => Promise<T>
): Promise<T> {
  return Sentry.startSpan({ op, name }, callback);
}

/**
 * Set user context for Sentry
 *
 * @param userId - The user's ID
 * @param email - Optional email address
 */
export function setUser(userId: string, email?: string): void {
  Sentry.setUser({
    id: userId,
    email,
  });
}

/**
 * Clear user context from Sentry
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Add a breadcrumb for debugging
 *
 * @param message - The breadcrumb message
 * @param category - The category of the breadcrumb
 * @param data - Optional additional data
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}
