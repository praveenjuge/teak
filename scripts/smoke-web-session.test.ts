import { describe, expect, test } from "bun:test";
import { cookiesFrom } from "./smoke-web-session.ts";

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
});
