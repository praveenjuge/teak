import { expect, type Locator, type Page } from "@playwright/test";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";

/** Real, authenticated persistence for editor E2E; owns only this run's cards. */
export class EditorLibrary {
  readonly ids: Id<"cards">[] = [];
  readonly client: ConvexHttpClient;
  readonly page: Page;

  constructor(page: Page, url: string, token: string) {
    this.page = page;
    this.client = new ConvexHttpClient(url);
    this.client.setAuth(token);
  }

  async create(content: string): Promise<Id<"cards">> {
    const id = await this.client.mutation(api.cards.createCard, {
      content,
      type: "text",
    });
    this.ids.push(id);
    return id;
  }

  async read(id: Id<"cards">): Promise<string> {
    const card = await this.client.query(api.cards.getCard, { id });
    if (!card) {
      throw new Error("Editor test card disappeared");
    }
    return card.content ?? "";
  }

  async open(id: Id<"cards">): Promise<Locator> {
    await this.page.goto(`/?card=${id}`);
    const dialog = this.page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", { name: "Markdown content" })
    ).toBeVisible();
    return dialog;
  }

  async cleanup(): Promise<void> {
    const results = await Promise.allSettled(
      this.ids.map((id) =>
        this.client.mutation(api.cards.permanentDeleteCard, { id })
      )
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Test card cleanup failed"
      );
    }
  }
}

export async function getBlockEditor(editor: Locator): Promise<Locator> {
  const textbox = editor.getByRole("textbox", { name: "Markdown content" });
  await expect(textbox).toHaveAttribute("contenteditable", "true");
  return textbox;
}

export async function pasteMarkdown(
  editor: Locator,
  markdown: string
): Promise<void> {
  const textbox = await getBlockEditor(editor);
  await textbox.focus();
  await textbox.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  }, markdown);
}

export async function goToEnd(editor: Locator): Promise<void> {
  await editor.focus();
  // Place the caret using the browser selection API, without touching editor
  // state or commands. This avoids platform-specific End key differences.
  await editor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}
