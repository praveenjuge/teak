import { expect, type Page, test } from "@playwright/test";
import { env } from "../helpers/env";
import {
  expectAuthEntry,
  readSignupCanaryEntry,
  WORKOS_SIGNUP_CANARY_UNSUPPORTED,
} from "../helpers/prod";

const hosted = "https://hosted-auth.example";
// Teak's retired email form. Under WorkOS-only sign-in it is never an entry.
const teakForm =
  '<div>Login to Teak</div><button>Continue with Google</button><form><label for="email">Email</label><input id="email" type="email"><label for="password">Password</label><input id="password" type="password"><button>Login</button></form>';
const hostedPage =
  '<label for="email">Email</label><input id="email" type="email"><button>Continue with email</button>';

type Entry = { form: string } | { hosted: "/" | "/sign-up" };

// Fulfilled 3xx responses make Chromium resolve the real host, so the hop to
// the hosted page is an immediate client redirect instead.
const redirectTo = (url: string) =>
  `<script>location.replace(${JSON.stringify(url)})</script>`;

// Serves a Teak entry path as a Teak-hosted page or as a redirect to a
// synthetic hosted page at `/` (sign-in) or `/sign-up`.
const serve = async (page: Page, path: string, entry: Entry) => {
  const requested: string[] = [];
  const app = new URL(env.appUrl).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requested.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    if (url.origin === app && url.pathname === path) {
      await route.fulfill(
        "form" in entry
          ? { contentType: "text/html", body: `<main>${entry.form}</main>` }
          : {
              contentType: "text/html",
              body: redirectTo(`${hosted}${entry.hosted}`),
            }
      );
    } else if (
      url.origin === hosted &&
      "hosted" in entry &&
      url.pathname === entry.hosted
    ) {
      await route.fulfill({
        contentType: "text/html",
        body: `<main>${hostedPage}</main>`,
      });
    } else {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  return requested;
};

for (const [flow, path, entry, expected] of [
  ["signin", "/login", { hosted: "/" }, "workos"],
  ["signup", "/register", { hosted: "/sign-up" }, "workos"],
  ["signup", "/register", { hosted: "/" }, "paused"],
] as const) {
  test(`${path} entry reads as ${expected}`, async ({ page }) => {
    await serve(page, path, entry);
    await page.goto(`${env.appUrl}${path}`);
    expect(await expectAuthEntry(page, flow)).toBe(expected);
  });
}

test("a Teak page between the app and hosted sign-in is not an entry", async ({
  page,
}) => {
  await serve(page, "/login", {
    form: '<p role="alert">Sign-in didn\'t finish.</p><a href="/sign-in">Try again</a>',
  });
  await page.goto(`${env.appUrl}/login`);
  await expect(
    expectAuthEntry(page, "signin", { timeout: 1000 })
  ).rejects.toThrow();
});

for (const [flow, path] of [
  ["signin", "/login"],
  ["signup", "/register"],
] as const) {
  test(`a Teak email form at ${path} is not an entry`, async ({ page }) => {
    await serve(page, path, { form: teakForm });
    await page.goto(`${env.appUrl}${path}`);
    await expect(expectAuthEntry(page, flow)).rejects.toThrow("hosted AuthKit");
  });
}

test("hosted sign-up does not pass as the sign-in entry", async ({ page }) => {
  await serve(page, "/login", { hosted: "/sign-up" });
  await page.goto(`${env.appUrl}/login`);
  await expect(expectAuthEntry(page, "signin")).rejects.toThrow();
});

test("sign-up email canary fails closed on hosted WorkOS sign-up", async ({
  page,
}) => {
  const requested = await serve(page, "/register", { hosted: "/sign-up" });
  await expect(readSignupCanaryEntry(page)).rejects.toThrow(
    WORKOS_SIGNUP_CANARY_UNSUPPORTED
  );
  // Only the redirect and the hosted page load: nothing is submitted.
  expect(requested.filter((entry) => !entry.endsWith("/favicon.ico"))).toEqual([
    `GET ${new URL(env.appUrl).origin}/register`,
    `GET ${hosted}/sign-up`,
  ]);
});

test("sign-up email canary uses the paused entry", async ({ page }) => {
  await serve(page, "/register", { hosted: "/" });
  expect(await readSignupCanaryEntry(page)).toBe("paused");
});
