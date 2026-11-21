import { afterAll, expect, test } from "bun:test";

// Its own file: AuthKit keeps the first configuration for the process, and
// this checks a Worker whose first request is a public path.
const keys = [
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
  "VITE_PUBLIC_WORKOS_REDIRECT_URI",
];
const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
process.env.WORKOS_CLIENT_ID = "client_web123";
process.env.WORKOS_COOKIE_PASSWORD = "test-session-password-for-fixtures-only";
Reflect.deleteProperty(process.env, "WORKOS_REDIRECT_URI");
process.env.VITE_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
const { signInGuard } = await import("../server/session");
const { validateConfig } = await import("@workos/authkit-session");

test("a public path first in a Worker still configures AuthKit", () => {
  expect(signInGuard(new Request("https://teak.test/sw.js"))).toBeNull();
  // AuthKit's middleware runs next and checks its settings; before the fix
  // this threw, and the Worker answered 503 to /share, /sw.js and the
  // manifest until a page configured it.
  expect(() => validateConfig()).not.toThrow();
});

afterAll(() => {
  for (const key of keys) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
