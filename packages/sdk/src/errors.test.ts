import { describe, expect, test } from "bun:test";
import {
  AUTH_ERROR_CODES,
  createTeakClient,
  ERROR_CODES,
  TeakApiError,
  teakErrorKind,
} from "./index";

const answering = (response: () => Response, seen: Request[] = []) =>
  createTeakClient({
    baseUrl: "https://api.example",
    retries: 0,
    fetch: ((url: string, init?: RequestInit) => {
      seen.push(new Request(url, init));
      return Promise.resolve(response());
    }) as typeof fetch,
    tokenProvider: { getAccessToken: () => "token" },
  });

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as TeakApiError
  );

describe("errors by kind", () => {
  test.each([
    [401, {}, "auth"],
    [401, { code: "INVALID_API_KEY" }, "auth"],
    [404, {}, "not_found"],
    [429, {}, "rate_limited"],
    [503, {}, "unavailable"],
    [400, { code: "INVALID_INPUT" }, "invalid"],
    [409, { code: "PIN_LIMIT_REACHED" }, "limit"],
    [409, { code: "TAG_EXISTS" }, "conflict"],
    [500, {}, "server"],
  ] as const)("HTTP %i %j is a %s failure", async (status, body, kind) => {
    const error = await rejection(
      answering(() => Response.json(body, { status })).me()
    );
    expect(teakErrorKind(error)).toBe(kind);
  });

  test("a request that never reaches Teak is a network failure", async () => {
    const client = createTeakClient({
      retries: 0,
      fetch: (() =>
        Promise.reject(new TypeError("offline"))) as unknown as typeof fetch,
      tokenProvider: { getAccessToken: () => "token" },
    });
    const error = await rejection(client.me());
    expect(error.kind).toBe("network");
  });

  test("a missing credential asks to sign in without naming a client", async () => {
    const client = createTeakClient({
      tokenProvider: { getAccessToken: () => null },
    });
    const error = await rejection(client.me());
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.kind).toBe("auth");
    expect(error.message).not.toMatch(/teak login|TEAK_API_KEY|raycast/i);
  });

  test("every error code has a kind, and the auth codes are the credential ones", () => {
    expect(ERROR_CODES.filter((code) => !new TeakApiError(code).kind)).toEqual(
      []
    );
    expect([...AUTH_ERROR_CODES].sort()).toEqual([
      "AUTH_REQUIRED",
      "INVALID_API_KEY",
      "UNAUTHORIZED",
    ]);
  });

  test("names the SDK, not a client, when the caller sets no user agent", async () => {
    const seen: Request[] = [];
    await answering(() => Response.json({ data: { id: "u1" } }), seen).me();
    expect(seen[0]?.headers.get("user-agent")).toBe("teak-sdk");
  });
});
