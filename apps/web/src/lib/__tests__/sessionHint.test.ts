import { describe, expect, test } from "bun:test";
import { syncSessionHint } from "@/lib/session-hint";

const written = (origin: string, hinted: boolean, signedIn: boolean) => {
  const headers = new Headers();
  const cookies = new Map(
    hinted ? [["teak_session_hint", { value: "1" }]] : []
  );
  syncSessionHint(cookies, headers, origin, signedIn);
  return headers.getSetCookie();
};

describe("session hint cookie", () => {
  test("production shares it with teakvault.com over HTTPS only", () => {
    expect(written("https://app.teakvault.com", false, true)).toEqual([
      "teak_session_hint=1; Path=/; Max-Age=2592000; Domain=teakvault.com; SameSite=Lax; Secure",
    ]);
  });
  test("clears it on the same domain it was set on", () => {
    expect(written("https://app.teakvault.com", true, false)).toEqual([
      "teak_session_hint=; Path=/; Max-Age=0; Domain=teakvault.com; SameSite=Lax; Secure",
    ]);
  });
  test("leaves a hint that already matches the session alone", () => {
    expect(written("https://app.teakvault.com", true, true)).toEqual([]);
    expect(written("https://app.teakvault.com", false, false)).toEqual([]);
  });
});
