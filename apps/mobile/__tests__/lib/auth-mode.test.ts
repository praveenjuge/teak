import { describe, expect, test } from "bun:test";
import { parseAuthMode } from "../../lib/auth-mode";

const legacy = {
  primary: "betterauth",
  signupsDisabled: true,
  accountChangesPaused: false,
};
describe("mobile public auth configuration", () => {
  test("accepts both providers and retains only public fields", () => {
    expect(parseAuthMode({ ...legacy, apiKey: "discard" })).toEqual(legacy);
    expect(
      parseAuthMode({
        ...legacy,
        primary: "workos",
        authKitClientId: "client_TEST",
      })
    ).toEqual({ ...legacy, primary: "workos", authKitClientId: "client_TEST" });
  });
  test.each(
    [
      null,
      [],
      {},
      { ...legacy, primary: "unknown" },
      { ...legacy, signupsDisabled: "true" },
      { ...legacy, accountChangesPaused: null },
      { ...legacy, authKitClientId: "client_TEST&client_secret=secret" },
      { ...legacy, primary: "workos" },
      { ...legacy, authKitClientId: `client_${"x".repeat(129)}` },
    ].map((value) => [value])
  )("rejects malformed or incomplete configuration", (value: unknown) => {
    expect(() => parseAuthMode(value)).toThrow(
      "Unable to load sign-in configuration"
    );
  });
});
