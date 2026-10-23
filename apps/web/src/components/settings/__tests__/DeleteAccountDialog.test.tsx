import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DeleteAccountDialog } = await import("../DeleteAccountDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const render = (open: boolean) =>
  act(() =>
    root?.render(
      <DeleteAccountDialog
        error={null}
        loading={false}
        onDelete={() => Promise.resolve()}
        onOpenChange={() => undefined}
        open={open}
      />
    )
  );

const field = () =>
  document.querySelector<HTMLInputElement>("#deleteConfirm") as
    | HTMLInputElement
    | undefined;

async function type(value: string) {
  const input = field();
  if (!input) {
    throw new Error("No confirmation field");
  }
  // React tracks the value through the native setter.
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const deleteButton = () =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Delete account"
  );

test("reopening the dialog starts with an empty confirmation", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render(true);
  await type("delete acc");
  expect(field()?.value).toBe("delete acc");

  await render(false);
  await render(true);

  expect(field()?.value).toBe("");
  expect(deleteButton()?.disabled).toBe(true);
});

test("the empty field doesn't look filled in", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render(true);

  expect(field()?.value).toBe("");
  expect(field()?.getAttribute("placeholder") ?? "").not.toContain(
    "delete account"
  );
  await type("Delete Account");
  expect(deleteButton()?.disabled).toBe(false);
});
