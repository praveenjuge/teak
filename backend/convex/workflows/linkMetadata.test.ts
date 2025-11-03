import { describe, expect, test } from "bun:test";
import { parseLinkMetadataRetryableError } from "./linkMetadata";
import {
  LINK_METADATA_RETRYABLE_PREFIX,
  type LinkMetadataRetryableError,
} from "./steps/linkMetadata/fetchMetadata";

describe("linkMetadata workflow retryable error parsing", () => {
  test("parses encoded error payload", () => {
    const payload: LinkMetadataRetryableError = {
      type: "rate_limit",
      normalizedUrl: "https://example.com",
      message: "Too many requests",
      details: { retryAfter: 30 },
    };
    const encoded = `${LINK_METADATA_RETRYABLE_PREFIX}${JSON.stringify(payload)}`;
    const error = new Error(encoded);

    expect(parseLinkMetadataRetryableError(error)).toEqual(payload);
  });

  test("returns null for non-prefix errors", () => {
    expect(parseLinkMetadataRetryableError(new Error("random error"))).toBeNull();
  });
});
