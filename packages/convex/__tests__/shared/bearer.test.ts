import { describe, expect, test } from "bun:test";
import {
  bearerCredentialKind,
  looksLikeAccessToken,
  MAX_BEARER_LENGTH,
  parseBearer,
} from "../../shared/bearer";
import { isWorkosIssuer } from "../../shared/oauthUrl";

const API_KEY = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;

describe("parseBearer", () => {
  test.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["  BEARER   abc  ", "abc"],
    ["Bearer abc def", "abc"],
  ])("reads the token of %p", (header, token) => {
    expect(parseBearer(header)).toBe(token);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["Bearer"],
    ["Bearer   "],
    ["Basic abc"],
    ["abc"],
  ])("finds no token in %p", (header) => {
    expect(parseBearer(header)).toBeNull();
  });
});

describe("bearerCredentialKind", () => {
  test("names an API key, an access token, junk and nothing", () => {
    expect(bearerCredentialKind(API_KEY)).toBe("api_key");
    expect(bearerCredentialKind("a.b.c")).toBe("workos_connect");
    expect(bearerCredentialKind("a.b")).toBe("malformed");
    expect(bearerCredentialKind(null)).toBe("missing");
  });

  test("reads a JWT-shaped token past the size limit as malformed", () => {
    const atLimit = `a.b.${"c".repeat(MAX_BEARER_LENGTH - 4)}`;
    expect(looksLikeAccessToken(atLimit)).toBe(true);
    expect(bearerCredentialKind(`${atLimit}c`)).toBe("malformed");
  });
});

describe("isWorkosIssuer", () => {
  test("accepts an HTTPS origin", () => {
    expect(isWorkosIssuer("https://auth.example.com")).toBe(true);
  });

  test.each([
    ["http://auth.example.com"],
    ["https://auth.example.com/"],
    ["https://auth.example.com/path"],
    ["https://auth.example.com:8443"],
    ["https://user:pass@auth.example.com"],
    ["https://localhost"],
    ["not a url"],
  ])("refuses %p", (value) => {
    expect(isWorkosIssuer(value)).toBe(false);
  });
});
