/// <reference types="bun" />
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type {
  CardPatchResponse,
  PatchCardPayload,
  SaveDetailsResponse,
} from "../../types/messages";
import { installChromeStorage } from "../helpers/chromeStorage";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// The other test files in this run expect Bun's own fetch and Request.
afterAll(() => GlobalRegistrator.unregister());

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SaveDetails } = await import("../../entrypoints/popup/SaveDetails");
const { MESSAGE_TYPES } = await import("../../types/messages");

const originalChrome = globalThis.chrome;
let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  globalThis.chrome = originalChrome;
});

interface Setup {
  details?: SaveDetailsResponse;
  existing?: boolean;
  patch?: (payload: PatchCardPayload) => CardPatchResponse;
}

async function render({
  details = { status: "ok", libraryTags: ["design", "reading"] },
  existing = false,
  patch = () => ({ status: "updated" }),
}: Setup = {}) {
  installChromeStorage();
  const patches: PatchCardPayload[] = [];
  const sendMessage = mock(
    (message: { payload: PatchCardPayload; type: string }) => {
      if (message.type === MESSAGE_TYPES.LOAD_SAVE_DETAILS) {
        return Promise.resolve(details);
      }
      patches.push(message.payload);
      return Promise.resolve(patch(message.payload));
    }
  );
  const drafts: unknown[] = [];
  const connect = mock(() => ({
    disconnect: mock(),
    postMessage: (message: { draft: unknown }) => drafts.push(message.draft),
  }));
  Object.assign(globalThis.chrome, { runtime: { connect, sendMessage } });
  const onTouched = mock();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <SaveDetails
        cardId="card_1"
        existing={existing}
        onTouched={onTouched}
        userId="user_1"
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { container, drafts, onTouched, patches };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const type = async (
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string
) => {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value"
  )?.set;
  await act(() => {
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const press = (field: HTMLElement, key: string) =>
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });

const tagInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[aria-label="Tags"]');
const noteField = (container: HTMLElement) =>
  container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]');

test("Enter in the tag input saves the tags at once", async () => {
  const { container, onTouched, patches } = await render();
  const input = tagInput(container) as HTMLInputElement;
  await act(() => input.focus());
  expect(onTouched).toHaveBeenCalled();
  await type(input, "design");
  await press(input, ",");
  await type(input, "to read");
  await press(input, "Enter");
  await settle();
  expect(patches).toEqual([
    {
      added: ["design", "to read"],
      cardId: "card_1",
      tags: ["design", "to read"],
    },
  ]);
  expect(container.textContent).toContain("to read");
});

test("a note saves when it loses focus and shows Saved", async () => {
  const { container, patches } = await render();
  const note = noteField(container) as HTMLTextAreaElement;
  await act(() => note.focus());
  await type(note, "Read the second half");
  await act(() => note.blur());
  await settle();
  expect(patches).toEqual([
    { cardId: "card_1", notes: "Read the second half" },
  ]);
  expect(container.textContent).toContain("Saved");
});

test("the background always holds what closing the popup would lose", async () => {
  const { container, drafts, patches } = await render();
  const note = noteField(container) as HTMLTextAreaElement;
  await act(() => note.focus());
  await type(note, "half typed");
  // Closing now: the background sends this draft when the port drops.
  expect(drafts.at(-1)).toEqual({ cardId: "card_1", notes: "half typed" });
  expect(patches).toEqual([]);
  await act(() => note.blur());
  await settle();
  expect(patches).toEqual([{ cardId: "card_1", notes: "half typed" }]);
  expect(drafts.at(-1)).toBeNull();
});

test("a save still on its way stays in the draft until Teak confirms it", async () => {
  // A blur as the popup closes sends the note, but that message can be lost
  // while the popup closes; the draft keeps it until the save is confirmed.
  let confirm: (result: { status: "updated" }) => void = () => undefined;
  const { container, drafts } = await render({
    patch: () => ({ status: "updated" }),
  });
  Object.assign(globalThis.chrome.runtime, {
    sendMessage: (message: { type: string }) =>
      message.type === MESSAGE_TYPES.PATCH_CARD
        ? new Promise((resolve) => {
            confirm = resolve;
          })
        : Promise.resolve({ status: "ok", libraryTags: [] }),
  });
  const note = noteField(container) as HTMLTextAreaElement;
  await act(() => note.focus());
  await type(note, "closing now");
  await act(() => note.blur());
  expect(drafts.at(-1)).toEqual({ cardId: "card_1", notes: "closing now" });
  await act(async () => {
    confirm({ status: "updated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(drafts.at(-1)).toBeNull();
});

test("a failed save hands the change back to the background", async () => {
  const { container, drafts } = await render({
    patch: () => ({ status: "error", message: "boom" }),
  });
  const input = tagInput(container) as HTMLInputElement;
  await type(input, "design");
  await press(input, "Enter");
  await settle();
  expect(drafts.at(-1)).toEqual({
    added: ["design"],
    cardId: "card_1",
    tags: ["design"],
  });
});

test("a tag over 64 characters is refused before any request", async () => {
  const { container, patches } = await render();
  const input = tagInput(container) as HTMLInputElement;
  await type(input, "a".repeat(65));
  await press(input, "Enter");
  expect(patches).toEqual([]);
  expect(container.textContent).toContain("Tags can be at most 64 characters.");
});

test("a failed save keeps what was typed and offers Retry", async () => {
  let fail = true;
  const { container, patches } = await render({
    patch: () =>
      fail ? { status: "error", message: "boom" } : { status: "updated" },
  });
  const input = tagInput(container) as HTMLInputElement;
  await type(input, "design");
  await press(input, "Enter");
  await settle();
  expect(container.textContent).toContain("Couldn't save tags.");
  expect(container.textContent).toContain("design");
  fail = false;
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry"
  );
  await act(() => retry?.click());
  await settle();
  expect(patches).toHaveLength(2);
  expect(container.textContent).not.toContain("Couldn't save tags.");
});

test("a rate limit says so and keeps the typed values", async () => {
  const { container } = await render({
    patch: () => ({
      status: "error",
      code: "RATE_LIMITED",
      message: "Too many requests. Try again in a moment",
    }),
  });
  const note = noteField(container) as HTMLTextAreaElement;
  await act(() => note.focus());
  await type(note, "keep me");
  await act(() => note.blur());
  await settle();
  expect(container.textContent).toContain(
    "Too many requests. Try again in a moment"
  );
  expect(note.value).toBe("keep me");
});

test("a page already saved fills in its own tags and note", async () => {
  const { container, patches } = await render({
    details: {
      status: "ok",
      libraryTags: [],
      card: { notes: "Earlier note", tags: ["design"] },
    },
    existing: true,
  });
  expect(container.textContent).toContain("design");
  expect(noteField(container)?.value).toBe("Earlier note");
  const input = tagInput(container) as HTMLInputElement;
  await type(input, "lamps");
  await press(input, "Enter");
  await settle();
  // Only the tag added here is remembered as recent, not the card's own.
  expect(patches).toEqual([
    { added: ["lamps"], cardId: "card_1", tags: ["design", "lamps"] },
  ]);
});

test("a page already saved shows no fields when its tags can't load", async () => {
  const { container } = await render({
    details: { status: "error", message: "nope" },
    existing: true,
  });
  expect(tagInput(container)).toBeNull();
  expect(container.textContent).toContain("Couldn't load this card's tags.");
});

test("suggestions show once the tag input has focus", async () => {
  const { container } = await render();
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  const input = tagInput(container) as HTMLInputElement;
  await act(() => input.focus());
  const options = [...container.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent
  );
  expect(options).toEqual(["design", "reading"]);
});
