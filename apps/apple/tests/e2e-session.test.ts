import { expect, test } from "bun:test";
import { loopbackUrl } from "../scripts/e2e-session";

test("posts only to an emulator on this machine", () => {
  expect(
    loopbackUrl("/user_management/users", "http://localhost:4100").href
  ).toBe("http://localhost:4100/user_management/users");
  expect(() =>
    loopbackUrl("/user_management/users", "https://api.workos.com")
  ).toThrow("The E2E emulator must run on this machine, not api.workos.com");
});
