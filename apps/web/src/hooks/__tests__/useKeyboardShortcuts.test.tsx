import {
  afterEach,
  beforeEach,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  CARD_DIALOG_ATTRIBUTE,
  SHORTCUTS_DIALOG_ATTRIBUTE,
  useKeyboardShortcuts,
} = await import("../useKeyboardShortcuts");

const search = mock(() => undefined);
const favorites = mock(() => undefined);
const help = mock(() => undefined);
const newCard = mock(() => undefined);

const SHORTCUTS = [
  { keys: "/", run: search },
  { keys: "g f", run: favorites },
  { alsoOver: CARD_DIALOG_ATTRIBUTE, keys: "?", run: help },
  { keys: "n", run: newCard },
];

let root: Root | undefined;

function Harness() {
  useKeyboardShortcuts(SHORTCUTS);
  return null;
}

beforeEach(async () => {
  for (const handler of [search, favorites, help, newCard]) {
    handler.mockClear();
  }
  setSystemTime(new Date("2026-10-14T10:00:00Z"));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(createElement(Harness)));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  setSystemTime();
});

const press = (
  key: string,
  init: KeyboardEventInit = {},
  target: Element = document.body
) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const later = (ms: number) => setSystemTime(new Date(Date.now() + ms));

test("a single key runs its shortcut and takes the key", () => {
  const event = press("/");
  expect(search).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

test("? needs Shift, and Shift with a letter is not a shortcut", () => {
  press("?", { shiftKey: true });
  expect(help).toHaveBeenCalledTimes(1);

  press("N", { shiftKey: true });
  expect(newCard).not.toHaveBeenCalled();
  press("n");
  expect(newCard).toHaveBeenCalledTimes(1);
});

test("modifier combos and held-down repeats are ignored", () => {
  press("n", { metaKey: true });
  press("n", { ctrlKey: true });
  press("n", { altKey: true });
  press("n", { repeat: true });
  expect(newCard).not.toHaveBeenCalled();
});

test("g then f within a second runs the sequence", () => {
  press("g");
  later(900);
  press("f");
  expect(favorites).toHaveBeenCalledTimes(1);
});

test("g then f after the timeout does nothing", () => {
  press("g");
  later(2000);
  const event = press("f");
  expect(favorites).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test("a sequence's second key never reaches the focused element", () => {
  const card = document.createElement("div");
  card.tabIndex = 0;
  document.body.append(card);
  const onCard = mock(() => undefined);
  card.addEventListener("keydown", onCard);

  press("g", {}, card);
  press("f", {}, card);
  expect(favorites).toHaveBeenCalledTimes(1);
  expect(onCard).not.toHaveBeenCalled();
});

test("an unknown second key falls through as a single key", () => {
  press("g");
  press("n");
  expect(newCard).toHaveBeenCalledTimes(1);
  expect(favorites).not.toHaveBeenCalled();
});

test.each([
  ["an input", () => document.createElement("input")],
  ["a textarea", () => document.createElement("textarea")],
  ["a select", () => document.createElement("select")],
  [
    "an editor",
    () => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const paragraph = document.createElement("p");
      editor.append(paragraph);
      return editor;
    },
  ],
])("typing in %s fires nothing", (_name, make) => {
  const field = make();
  document.body.append(field);
  const target = field.firstElementChild ?? field;
  press("/", {}, target);
  press("n", {}, target);
  press("g", {}, target);
  press("f", {}, target);
  expect(search).not.toHaveBeenCalled();
  expect(newCard).not.toHaveBeenCalled();
  expect(favorites).not.toHaveBeenCalled();
});

test("an open dialog or menu silences shortcuts, but not the shortcuts list", () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-state", "open");
  document.body.append(dialog);
  press("n");
  press("?", { shiftKey: true });
  expect(newCard).not.toHaveBeenCalled();
  expect(help).not.toHaveBeenCalled();

  dialog.setAttribute("data-state", "closed");
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("data-state", "open");
  document.body.append(menu);
  press("n");
  expect(newCard).not.toHaveBeenCalled();
  menu.remove();

  const list = document.createElement("div");
  list.setAttribute("role", "dialog");
  list.setAttribute("data-state", "open");
  list.setAttribute(SHORTCUTS_DIALOG_ATTRIBUTE, "");
  document.body.append(list);
  press("g", {}, list);
  press("f", {}, list);
  expect(favorites).toHaveBeenCalledTimes(1);
});

test("? still works over an open card, but not over a menu on it", () => {
  const card = document.createElement("div");
  card.setAttribute("role", "dialog");
  card.setAttribute("data-state", "open");
  card.setAttribute(CARD_DIALOG_ATTRIBUTE, "");
  document.body.append(card);
  press("n", {}, card);
  expect(newCard).not.toHaveBeenCalled();
  press("?", { shiftKey: true }, card);
  expect(help).toHaveBeenCalledTimes(1);

  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("data-state", "open");
  document.body.append(menu);
  press("?", { shiftKey: true }, menu);
  expect(help).toHaveBeenCalledTimes(1);
});
