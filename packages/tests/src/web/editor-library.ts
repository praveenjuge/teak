import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { gotoApp } from "../helpers/app";
import {
  type Browser,
  expect,
  type Locator,
  type Surface,
} from "../helpers/test";

export class EditorLibrary {
  readonly ids: Id<"cards">[] = [];
  readonly client: ConvexHttpClient;
  readonly surface: Surface;

  constructor(surface: Surface, url: string, token: string) {
    this.surface = surface;
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
    await gotoApp(this.surface.browser, `/?card=${id}`);
    const dialog = this.surface.screen.getByRole("dialog");
    await expect(dialog.getByRole("textbox", "Markdown content")).toBeVisible();
    return dialog;
  }

  async waitForProcessing(ids: Iterable<Id<"cards">>): Promise<void> {
    const cardIds = [...ids];
    const isProcessing = async (id: Id<"cards">) => {
      const card = await this.client.query(api.cards.getCard, { id });
      const stages: ({ status?: string } | undefined)[] = Object.values(
        card?.processingStatus ?? {}
      );
      return stages.some(
        (stage) =>
          stage?.status === "pending" || stage?.status === "in_progress"
      );
    };
    const processing = async () =>
      (await Promise.all(cardIds.map(isProcessing))).filter(Boolean).length;
    await expect.poll(processing, { timeout: 120_000 }).toBe(0);
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
        `Test card cleanup failed: ${failures
          .map((result) => String(result.reason))
          .join("; ")}`
      );
    }
  }
}

export const DIALOG_EDITOR =
  '[role="dialog"] [role="textbox"][aria-label="Markdown content"]';
export const COMPOSER_EDITOR =
  'form[data-card-creation-status] [role="textbox"][aria-label="Markdown content"]';

export async function getBlockEditor(editor: Locator): Promise<Locator> {
  const textbox = editor.getByRole("textbox", "Markdown content");
  await expect(textbox).toHaveAttribute("contenteditable", "true");
  return textbox;
}

/**
 * Dispatches a paste of `markdown` on the editor that `selector` names: a
 * synthetic ClipboardEvent, since a headless browser has no clipboard.
 */
export async function pasteMarkdown(
  browser: Browser,
  selector: string,
  markdown: string,
  html?: string
): Promise<void> {
  await browser.locator(selector).focus();
  await browser.evaluate(
    ([target, text, markup]) => {
      const element = document.querySelector(target);
      if (!element) {
        throw new Error(`No element for ${target}`);
      }
      const data = new DataTransfer();
      data.setData("text/plain", text);
      if (markup) {
        data.setData("text/html", markup);
      }
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      );
      return null;
    },
    [selector, markdown, html ?? ""] as [string, string, string]
  );
}

/**
 * Places the caret at the end of the editor that `selector` names, through
 * the browser selection API, without touching editor state or commands.
 * This avoids platform-specific End key differences.
 */
export async function goToEnd(
  browser: Browser,
  selector: string
): Promise<void> {
  await browser.locator(selector).focus();
  await browser.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) {
      throw new Error(`No element for ${target}`);
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return null;
  }, selector);
}
