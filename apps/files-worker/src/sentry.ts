// Error reporting for the files worker, mirroring the web app's Sentry setup
// (apps/web/src/lib/sentry-config.ts) at a scale appropriate for a hot file
// proxy: errors only — no tracing or log sampling.
//
// This module is intentionally self-contained (no @teak/convex dependency) so
// the deployed worker bundle stays free of backend code. The DSN is supplied
// as a wrangler secret rather than anything committed to the repo:
//
//   bunx wrangler secret put SENTRY_DSN
//
// Because secrets only exist on `env` at request time, initialization happens
// per request via withSentry's options callback; without a DSN (tests, local
// dev, before the secret is set) the SDK runs with a disabled client and every
// capture call below degrades to a no-op.

import type { CloudflareOptions } from "@sentry/cloudflare";
import { captureException } from "@sentry/cloudflare";

/** Env vars backing error reporting; SENTRY_DSN is a wrangler secret. */
export interface SentryEnvVars {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
}

export const resolveSentryOptions = (
  env: SentryEnvVars
): CloudflareOptions | undefined => {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return undefined;
  }
  const environment = env.SENTRY_ENVIRONMENT?.trim();
  const release = env.SENTRY_RELEASE?.trim();
  return {
    dsn,
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    // Requests are HMAC-signed URLs and internal ops; never attach PII.
    sendDefaultPii: false,
  };
};

export interface FileKeyIdentifiers {
  cardId?: string;
  role?: string;
}

/**
 * Best-effort card/role extraction from an R2 object key. Keys minted by
 * buildR2ObjectKey (packages/convex/storage/r2.ts) look like
 * users/<user-hash>/cards/<cardId|pending>/<role>/<uuid>-<name>; anything
 * else parses to no identifiers instead of guessing.
 */
export const parseFileKeyIdentifiers = (key: string): FileKeyIdentifiers => {
  const segments = key.split("/");
  if (
    segments.length < 5 ||
    segments[0] !== "users" ||
    segments[2] !== "cards"
  ) {
    return {};
  }
  const [cardId, role] = [segments[3], segments[4]];
  return {
    ...(cardId && cardId !== "pending" ? { cardId } : {}),
    ...(role ? { role } : {}),
  };
};

export interface FilesOpFailureContext {
  httpMethod: string;
  httpPath: string;
  objectKey: string;
}

const MAX_CONTEXT_STRING_LENGTH = 256;

const bounded = (value: string): string =>
  value.length <= MAX_CONTEXT_STRING_LENGTH
    ? value
    : value.slice(0, MAX_CONTEXT_STRING_LENGTH);

/**
 * Explicit capture for op failures that handleOp already converted into 500
 * responses — they never propagate out of fetch(), so withSentry's automatic
 * unhandled-error capture cannot see them (this is exactly how the
 * image-analysis outages can otherwise stay invisible).
 */
export const reportFilesOpFailure = (
  op: string,
  error: unknown,
  { httpMethod, httpPath, objectKey }: FilesOpFailureContext
): void => {
  const { cardId, role } = parseFileKeyIdentifiers(objectKey);
  captureException(error, {
    tags: {
      "files.op": op,
    },
    contexts: {
      files_op: {
        ...(cardId ? { "card.id": cardId } : {}),
        "http.method": httpMethod.toUpperCase(),
        "http.path": bounded(httpPath),
        "object.key": bounded(objectKey),
        ...(role ? { "object.role": role } : {}),
      },
    },
  });
};
