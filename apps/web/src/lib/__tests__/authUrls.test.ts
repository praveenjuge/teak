import { describe, expect, test } from "bun:test";
import { workosEntryRedirect } from "../auth-entry";
import { signInPath, signInUrl } from "../authUrls";

describe("sign-in URLs", () => {
  test("carry what the sign-in route reads back", () => {
    const next = "/settings?tab=api keys&x=1";
    const url = signInUrl("https://app.example", { next, renew: true });
    expect(url.origin).toBe("https://app.example");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("next")).toBe(next);
    expect(url.searchParams.has("renew")).toBe(true);
  });

  test("a plain sign-in carries no params", () => {
    expect(signInPath()).toBe("/sign-in");
  });

  test.each([
    ["reauth", { reauth: true }],
    ["renew", { renew: true }],
  ] as const)(
    "a signed-in visit with %s still goes to AuthKit",
    (_name, options) => {
      const url = signInUrl("https://app.example", {
        ...options,
        next: "/tags",
      });
      expect(workosEntryRedirect(url, true)).toBeNull();
    }
  );

  test("a signed-in visit without them goes straight to next", () => {
    const url = signInUrl("https://app.example", { next: "/tags" });
    expect(workosEntryRedirect(url, true)?.href).toBe(
      "https://app.example/tags"
    );
  });
});
