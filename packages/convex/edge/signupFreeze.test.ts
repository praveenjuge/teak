import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { setSignupsPaused } from "../__tests__/helpers/signups.test-utils";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
});

test("public auth mode reports WorkOS and the sign-up flag without exposing credentials", async () => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_TEST");
  vi.stubEnv("WORKOS_API_KEY", "must-not-reach-clients");
  const t = convexTest(schema, modules);
  await setSignupsPaused(t, true);
  expect(await t.query(api.auth.getAuthMode, {})).toEqual({
    primary: "workos",
    signupsDisabled: true,
    accountChangesPaused: false,
    authKitClientId: "client_TEST",
  });
  await setSignupsPaused(t, false);
  expect(await t.query(api.auth.getAuthMode, {})).toEqual({
    primary: "workos",
    signupsDisabled: false,
    accountChangesPaused: false,
    authKitClientId: "client_TEST",
  });
});
