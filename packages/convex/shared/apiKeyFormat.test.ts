import { describe, expect, test } from "bun:test";
import { API_KEY_TOKEN_PREFIX, isWellFormedApiKey } from "./apiKeyFormat";

describe("apiKeyFormat", () => {
  test("accepts a canonical teakapi_<prefix>_<secret> token", () => {
    expect(
      isWellFormedApiKey(`${API_KEY_TOKEN_PREFIX}_abc123_secretvalue`)
    ).toBe(true);
  });

  test("trims surrounding whitespace before checking", () => {
    expect(isWellFormedApiKey("  teakapi_abc123_secretvalue  ")).toBe(true);
  });

  test("rejects tokens without the teakapi prefix", () => {
    expect(isWellFormedApiKey("nope_abc123_secretvalue")).toBe(false);
    expect(isWellFormedApiKey("sk_live_abc123")).toBe(false);
  });

  test("rejects tokens with the wrong number of segments", () => {
    expect(isWellFormedApiKey("teakapi_abc123")).toBe(false);
    expect(isWellFormedApiKey("teakapi_abc123_secret_extra")).toBe(false);
  });

  test("rejects tokens with empty prefix or secret segments", () => {
    expect(isWellFormedApiKey("teakapi__secret")).toBe(false);
    expect(isWellFormedApiKey("teakapi_prefix_")).toBe(false);
    expect(isWellFormedApiKey("teakapi__")).toBe(false);
  });

  test("rejects empty and whitespace-only tokens", () => {
    expect(isWellFormedApiKey("")).toBe(false);
    expect(isWellFormedApiKey("   ")).toBe(false);
  });
});
