import { describe, expect, test } from "bun:test";
import { cookiesFrom, describeAuthFailure } from "./smoke-web-session.ts";

describe("smoke-web-session", () => {
  test("cookiesFrom joins set-cookie pairs without attributes", () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "teak.session=a1b2; Path=/; HttpOnly; SameSite=Lax"
    );
    headers.append("set-cookie", "other=x; Path=/");
    expect(cookiesFrom(headers)).toBe("teak.session=a1b2; other=x");
  });

  test("cookiesFrom is empty without set-cookie", () => {
    expect(cookiesFrom(new Headers())).toBe("");
  });

  test("auth failures name the Better Auth error code", () => {
    const body = JSON.stringify({
      code: "FAILED_TO_CREATE_USER",
      message: "Failed to create user",
    });
    expect(describeAuthFailure(422, body)).toBe("422 (FAILED_TO_CREATE_USER)");
  });

  test.each([
    ["non-JSON bodies", "<html>Bad gateway</html>"],
    ["JSON without a code", JSON.stringify({ message: "nope" })],
    ["codes that are not enum-shaped", JSON.stringify({ code: "user@x.y" })],
  ])("auth failures report only the status for %s", (_label, body) => {
    expect(describeAuthFailure(502, body)).toBe("502");
  });
});
