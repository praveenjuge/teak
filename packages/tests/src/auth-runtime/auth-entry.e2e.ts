import { expect, type Page, test } from "@playwright/test";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { env } from "../helpers/env";
import {
  expectAuthEntry,
  readSignupCanaryEntry,
  WORKOS_SIGNUP_CANARY_UNSUPPORTED,
} from "../helpers/prod";

const betterAuthForm =
  '<div>Login to Teak</div><button>Continue with Google</button><form><label for="email">Email</label><input id="email" type="email"><label for="password">Password</label><input id="password" type="password"><button>Login</button></form>';
const workosEntry = (title: string, alternate: string, button = "Continue") =>
  `<div>${title}</div><p>Continue to secure sign-in with your email, Google, or Apple.</p><button>${button}</button><a href="/elsewhere">${alternate}</a>`;
const workosSignin = workosEntry("Login to Teak", "New user? Register");
const workosSignup = workosEntry(
  "Create your Teak account",
  "Already have an account? Sign in"
);
const paused = `<p role="status">${SIGNUPS_PAUSED_MESSAGE}</p><a href="/login">Sign in</a>`;

const serve = async (page: Page, path: string, body: string) => {
  const requested: string[] = [];
  await page.route(`${env.appUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    requested.push(`${route.request().method()} ${url.pathname}`);
    await route.fulfill(
      url.pathname === path
        ? { contentType: "text/html", body: `<main>${body}</main>` }
        : { status: 404, body: "" }
    );
  });
  return requested;
};

for (const [flow, path, body, expected] of [
  ["signin", "/login", betterAuthForm, "betterauth"],
  ["signin", "/login", workosSignin, "workos"],
  ["signup", "/register", betterAuthForm, "betterauth"],
  ["signup", "/register", workosSignup, "workos"],
  ["signup", "/register", paused, "paused"],
] as const) {
  test(`${path} entry reads as ${expected}`, async ({ page }) => {
    await serve(page, path, body);
    await page.goto(`${env.appUrl}${path}`);
    expect(await expectAuthEntry(page, flow)).toBe(expected);
  });
}

test("WorkOS error state is not a ready entry", async ({ page }) => {
  await serve(
    page,
    "/login",
    `<p role="alert">Sign-in changed. Please start again.</p>${workosEntry("Login to Teak", "New user? Register", "Try again")}`
  );
  await page.goto(`${env.appUrl}/login`);
  await expect(
    expectAuthEntry(page, "signin", { timeout: 1000 })
  ).rejects.toThrow();
});

test("a sign-in entry does not pass as the sign-up entry", async ({ page }) => {
  await serve(page, "/register", workosSignin);
  await page.goto(`${env.appUrl}/register`);
  await expect(expectAuthEntry(page, "signup")).rejects.toThrow();
});

test("paused status is only accepted on sign-up", async ({ page }) => {
  await serve(page, "/login", paused);
  await page.goto(`${env.appUrl}/login`);
  await expect(
    expectAuthEntry(page, "signin", { timeout: 1000 })
  ).rejects.toThrow();
});

test("sign-up email canary fails closed on hosted WorkOS sign-up", async ({
  page,
}) => {
  const requested = await serve(page, "/register", workosSignup);
  await expect(readSignupCanaryEntry(page)).rejects.toThrow(
    WORKOS_SIGNUP_CANARY_UNSUPPORTED
  );
  // Nothing past the entry page: no Continue click, no hosted sign-up.
  expect(requested.filter((entry) => entry !== "GET /favicon.ico")).toEqual([
    "GET /register",
  ]);
});

for (const [body, expected] of [
  [betterAuthForm, "betterauth"],
  [paused, "paused"],
] as const) {
  test(`sign-up email canary uses the ${expected} entry`, async ({ page }) => {
    await serve(page, "/register", body);
    expect(await readSignupCanaryEntry(page)).toBe(expected);
  });
}
