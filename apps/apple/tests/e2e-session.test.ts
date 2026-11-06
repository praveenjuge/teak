import { expect, test } from "bun:test";
import { loopbackUrl, runnerExports } from "../scripts/e2e-session";

test("posts only to an emulator on this machine", () => {
  expect(
    loopbackUrl("/user_management/users", "http://localhost:4100").href
  ).toBe("http://localhost:4100/user_management/users");
  expect(() =>
    loopbackUrl("/user_management/users", "https://api.workos.com")
  ).toThrow("The E2E emulator must run on this machine, not api.workos.com");
});

test("exports the stack's URLs for the XCUITest runner, shell-quoted", () => {
  expect(
    runnerExports({
      appOrigin: "http://localhost:4600",
      convexUrl: "http://127.0.0.1:4610",
      emulatorOrigin: "http://localhost:4620/it's",
    })
  ).toBe(
    [
      "export TEST_RUNNER_TEAK_E2E_CONVEX_URL='http://127.0.0.1:4610'",
      "export TEST_RUNNER_TEAK_E2E_EMULATOR_URL='http://localhost:4620/it'\\''s'",
      "export TEST_RUNNER_TEAK_E2E_WEB_URL='http://localhost:4600'",
    ].join("\n")
  );
});
