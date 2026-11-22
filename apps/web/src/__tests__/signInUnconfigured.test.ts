import { afterAll, expect, test } from "bun:test";

// Its own file: the first configuration that works is kept for the process.
const keys = [
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "VITE_PUBLIC_WORKOS_REDIRECT_URI",
];
const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
process.env.WORKOS_CLIENT_ID = "client_web123";
process.env.WORKOS_COOKIE_PASSWORD = "short";
process.env.VITE_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
const { signInGuard } = await import("../server/session");

test("fails closed when sign-in is not configured", async () => {
  const response = signInGuard(new Request("http://localhost:3142/settings"));
  expect(response?.status).toBe(503);
  expect(response?.headers.get("location")).toBeNull();
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response?.text()).toContain(
    "Sign-in is temporarily unavailable"
  );
});

test("pages that answer without a session still work", () => {
  for (const path of ["/share"]) {
    expect(signInGuard(new Request(`http://localhost:3142${path}`))).toBeNull();
  }
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
