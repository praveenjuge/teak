import { clientFor, createAccount, gotoApp } from "../helpers/app";
import { expect, test } from "../helpers/test";

// The dev server compiles each route on its first visit and a freshly pushed
// backend loads each module on its first call. Do both once, signed in and
// alone, before the suites start sharing the runner.
test("signed-in routes and backend modules are warm", {
  timeout: 240_000,
}, async ({ browser, screen }) => {
  const { apiKey } = await createAccount({ browser, screen }, "warmup");
  const { cardId } = await clientFor(apiKey ?? "").cards.create({
    content: "Warm-up card",
  });
  await gotoApp(browser, `/?card=${cardId}`);
  await expect(
    screen.getByRole("dialog").getByRole("textbox", "Markdown content")
  ).toBeVisible();
  for (const path of ["/favorites", "/archive", "/trash"]) {
    await gotoApp(browser, path);
    await expect(screen.getByRole("combobox")).toBeVisible();
  }
  await gotoApp(browser, "/tags");
  await expect(screen.getByRole("heading", "Tags", { level: 1 })).toBeVisible();
  await gotoApp(browser, "/settings");
  await expect(
    screen.getByRole("heading", "Settings", { level: 1 })
  ).toBeVisible();
});
