import { clientFor, createAccount, gotoApp } from "../helpers/app";
import { expect, test } from "../helpers/test";

test("Empty Trash deletes every card in Trash for good", {
  timeout: 180_000,
}, async ({ browser, screen }) => {
  const account = await createAccount({ browser, screen }, "empty-trash");
  const api = clientFor(account.apiKey ?? "");
  const marker = `emptytrash${Date.now().toString(36)}`;
  const first = await api.cards.create({ content: `${marker} first` });
  const second = await api.cards.create({ content: `${marker} second` });
  await api.cards.delete(first.cardId);
  await api.cards.delete(second.cardId);

  await gotoApp(browser, "/trash");
  const main = screen.getByRole("main");
  await expect(main.getByText(`${marker} first`, { exact: false })).toBeVisible(
    { timeout: 30_000 }
  );
  await expect(
    main.getByText(`${marker} second`, { exact: false })
  ).toBeVisible();

  const emptyTrash = screen.getByRole("button", "Empty Trash");
  await expect(emptyTrash).toBeEnabled({ timeout: 30_000 });
  await emptyTrash.click();
  const confirm = screen.getByRole("alertdialog");
  await expect(
    confirm.getByText(
      "This permanently deletes 2 cards and their files. This can’t be undone."
    )
  ).toBeVisible();
  await confirm.getByRole("button", "Empty Trash").click();

  await expect(screen.getByText("Trash is empty.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(screen.getByRole("button", "Empty Trash")).toBeDisabled();
  for (const cardId of [first.cardId, second.cardId]) {
    await expect
      .poll(() =>
        api.cards.get(cardId).then(
          () => "found",
          () => "gone"
        )
      )
      .toBe("gone");
  }
});
