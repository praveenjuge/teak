/**
 * Shared retryable-error contract for the link-metadata step.
 *
 * These live in their own module (no `"use node"`, no Node built-ins) so that
 * default-runtime workflow files can import the prefix/type WITHOUT statically
 * pulling the `"use node"` action file — and its Node-only imports — into the
 * Convex V8 isolate bundle.
 */

export interface LinkMetadataRetryableError {
  details?: unknown;
  message?: string;
  normalizedUrl?: string;
  type: string;
}

export const LINK_METADATA_RETRYABLE_PREFIX =
  "workflow:linkMetadata:retryable:";
