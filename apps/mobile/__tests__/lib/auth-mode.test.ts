import { describe, expect, test } from "bun:test";
import { parseAuthMode } from "../../lib/auth-mode";

const workos = {
  primary: "workos",
  signupsDisabled: true,
  accountChangesPaused: false,
  authKitClientId: "client_TEST",
};
describe("mobile public auth configuration", () => {
  test("accepts WorkOS and retains only public fields", () => {
    expect(parseAuthMode({ ...workos, apiKey: "discard" })).toEqual(workos);
  });
  test.each(
    [
      null,
      [],
      {},
      { ...workos, primary: "betterauth" },
      { ...workos, primary: "unknown" },
      { ...workos, signupsDisabled: "true" },
      { ...workos, accountChangesPaused: null },
      { ...workos, authKitClientId: "client_TEST&client_secret=secret" },
      { ...workos, authKitClientId: undefined },
      { ...workos, authKitClientId: `client_${"x".repeat(129)}` },
    ].map((value) => [value])
  )("rejects malformed or incomplete configuration", (value: unknown) => {
    expect(() => parseAuthMode(value)).toThrow(
      "Unable to load sign-in configuration"
    );
  });
});
