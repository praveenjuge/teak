import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";
import { signIn } from "../helpers/prod";

const email = "e2e-runtime@tests.example.com";
const password = "test-only-password";
const editor = '<textarea aria-label="Markdown content"></textarea>';
for (const scenario of [
  "workos",
  "authenticated",
  "workos-rejected",
  "workos-email-rejected",
] as const) {
  const provider = scenario.split("-")[0];
  const emailRejected = scenario === "workos-email-rejected";
  const rejected = scenario.endsWith("-rejected");
  test(`sign-in helper follows ${scenario} browser behavior`, async ({
    page,
  }) => {
    const submissions: string[] = [];
    await page.route(`${env.appUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/login" && provider === "workos") {
        await route.fulfill({
          contentType: "text/html",
          body: '<script>location.replace("/provider")</script>',
        });
      } else if (url.pathname === "/login") {
        await route.fulfill({ contentType: "text/html", body: editor });
      } else if (url.pathname === "/provider") {
        await route.fulfill({
          contentType: "text/html",
          body: '<form method="post" action="/password"><label>Email<input name="email"></label><button>Continue with email</button></form>',
        });
      } else if (url.pathname === "/password") {
        submissions.push(route.request().postData() ?? "");
        await route.fulfill({
          contentType: "text/html",
          body: emailRejected
            ? '<p role="alert">Invalid credentials</p>'
            : '<form method="post" action="/accepted"><label>Password<input name="password" type="password"></label><button>Sign in</button></form>',
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
      if (!emailRejected) {
        expect(submissions.join("&")).toContain(
          new URLSearchParams({ password }).toString()
        );
      }
    }
  });
}
