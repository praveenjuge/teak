import { describe, expect, test } from "bun:test";
import {
  API_KEY_TOKEN_PREFIX,
  getApiKeyFormat,
  isWellFormedApiKey,
} from "./apiKeyFormat";

describe("apiKeyFormat", () => {
  test("treats the retired teakapi_<prefix>_<secret> token as malformed", () => {
    const token = `${API_KEY_TOKEN_PREFIX}_abc123_secretvalue`;

    expect(isWellFormedApiKey(token)).toBe(false);
    expect(getApiKeyFormat(token)).toBe("malformed");
  });

  test("accepts a component-managed teakapi secret token", () => {
    const token = `${API_KEY_TOKEN_PREFIX}_secret_live_a1b2c3d4_${"f".repeat(64)}`;

    expect(isWellFormedApiKey(token)).toBe(true);
    expect(getApiKeyFormat(token)).toBe("component");
  });

  test("trims surrounding whitespace before checking", () => {
    const token = `  ${API_KEY_TOKEN_PREFIX}_secret_live_a1b2c3d4_${"f".repeat(64)}  `;
    expect(isWellFormedApiKey(token)).toBe(true);
    expect(getApiKeyFormat(token.trim())).toBe("component");
  });

  test("rejects tokens without the teakapi prefix", () => {
    expect(isWellFormedApiKey("nope_abc123_secretvalue")).toBe(false);
    expect(isWellFormedApiKey("sk_live_abc123")).toBe(false);
  });

  test("rejects tokens with the wrong number of segments", () => {
    expect(isWellFormedApiKey("teakapi_abc123")).toBe(false);
    expect(isWellFormedApiKey("teakapi_abc123_secret_extra")).toBe(false);
    expect(isWellFormedApiKey("teakapi_secret_live_lookup")).toBe(false);
  });

  test("rejects malformed component tokens", () => {
    expect(
      isWellFormedApiKey(`${API_KEY_TOKEN_PREFIX}_write_live_a1b2c3d4_${"f".repeat(64)}`)
    ).toBe(false);
    expect(
      isWellFormedApiKey(`${API_KEY_TOKEN_PREFIX}_secret_live_short_${"f".repeat(64)}`)
    ).toBe(false);
    expect(
      isWellFormedApiKey(`${API_KEY_TOKEN_PREFIX}_secret_live_a1b2c3d4_short`)
    ).toBe(false);
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
