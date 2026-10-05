import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";
import { signIn } from "../helpers/prod";

const email = "e2e-runtime@tests.example.com";
const password = "test-only-password";
const editor = '<textarea aria-label="Markdown content"></textarea>';
const fields =
  '<label>Email<input name="email"></label><label>Password<input name="password" type="password"></label><button>Login</button>';
for (const scenario of [
  "betterauth",
  "workos",
  "authenticated",
  "betterauth-rejected",
  "workos-rejected",
] as const) {
  const provider = scenario.replace("-rejected", "");
  const rejected = scenario.endsWith("-rejected");
  test(`sign-in helper follows ${scenario} browser behavior`, async ({
    page,
  }) => {
    const submissions: string[] = [];
    await page.route(`${env.appUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/login") {
        let html = editor;
        if (provider === "betterauth") {
          html = `<form method="post" action="/accepted">${fields}</form>`;
        }
        if (provider === "workos") {
          html = '<a role="button" href="/provider">Continue</a>';
        }
        await route.fulfill({ contentType: "text/html", body: html });
      } else if (url.pathname === "/provider") {
        await route.fulfill({
          contentType: "text/html",
          body: '<form method="post" action="/password"><label>Email<input name="email"></label><button>Continue with email</button></form>',
        });
      } else if (url.pathname === "/password") {
        submissions.push(route.request().postData() ?? "");
        await route.fulfill({
          contentType: "text/html",
          body: '<form method="post" action="/accepted"><label>Password<input name="password" type="password"></label><button>Sign in</button></form>',
        });
      } else if (url.pathname === "/accepted") {
        submissions.push(route.request().postData() ?? "");
        await route.fulfill({
          contentType: "text/html",
          body: rejected ? '<p role="alert">Invalid credentials</p>' : editor,
        });
      } else {
        throw new Error(`Unexpected path ${url.pathname}`);
      }
    });
    await signIn(
      page,
      email,
      password,
      rejected ? { failure: /invalid credentials/i } : {}
    );
    if (rejected) {
      await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
      await expect(
        page.getByRole("textbox", { name: "Markdown content" })
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("textbox", { name: "Markdown content" })
      ).toBeVisible();
    }
    if (provider === "authenticated") {
      expect(submissions).toEqual([]);
    } else {
      expect(submissions.join("&")).toContain(
        new URLSearchParams({ email }).toString()
      );
      expect(submissions.join("&")).toContain(
        new URLSearchParams({ password }).toString()
      );
    }
  });
}
