import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Label } = await import("../label");
const { Separator } = await import("../separator");
let root: Root | undefined;

afterEach(async () => {
  await act(() => {
    root?.unmount();
    return Promise.resolve();
  });
  root = undefined;
  document.body.innerHTML = "";
});

async function render(children: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => {
    root?.render(children);
    return Promise.resolve();
  });
  return container;
}

test("a label activates its associated checkbox and forwards its ref", async () => {
  const ref = createRef<HTMLLabelElement>();
  await render(
    <>
      <Label htmlFor="choice" ref={ref}>
        Choice
      </Label>
      <input id="choice" type="checkbox" />
    </>
  );
  const input = document.getElementById("choice");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Missing checkbox");
  }
  await act(() => {
    ref.current?.click();
    return Promise.resolve();
  });
  expect(input.checked).toBe(true);
  expect(ref.current?.tagName).toBe("LABEL");
});

test("multiple mouse presses on label text prevent selection but single presses do not", async () => {
  const onMouseDown = mock();
  const container = await render(
    <Label htmlFor="field" onMouseDown={onMouseDown}>
      Name
    </Label>
  );
  for (const detail of [1, 2, 3]) {
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      detail,
    });
    await act(() => container.querySelector("label")?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(detail > 1);
  }
  expect(onMouseDown).toHaveBeenCalledTimes(3);
});

test("a label respects caller cancellation and leaves nested controls alone", async () => {
  const onMouseDown = mock((event: { preventDefault: () => void }) => {
    event.preventDefault();
  });
  const container = await render(
    <Label onMouseDown={onMouseDown}>
      <input aria-label="Name" />
    </Label>
  );
  const textPress = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  await act(() => container.querySelector("label")?.dispatchEvent(textPress));
  expect(textPress.defaultPrevented).toBe(true);
  const inputPress = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  await act(() => container.querySelector("input")?.dispatchEvent(inputPress));
  expect(inputPress.defaultPrevented).toBe(false);
  expect(onMouseDown).toHaveBeenCalledTimes(1);
});

test("a label can use its child without adding a wrapper", async () => {
  const container = await render(
    <Label asChild className="custom">
      <label htmlFor="field">Name</label>
    </Label>
  );
  expect(container.querySelectorAll("label").length).toBe(1);
  expect(container.firstElementChild?.getAttribute("data-slot")).toBe("label");
  expect(container.firstElementChild?.classList.contains("custom")).toBe(true);
});

test("decorative separators are absent from the accessibility tree", async () => {
  const container = await render(<Separator />);
  expect(container.firstElementChild?.getAttribute("role")).toBe("none");
  expect(container.firstElementChild?.getAttribute("data-orientation")).toBe(
    "horizontal"
  );
  expect(container.firstElementChild?.hasAttribute("aria-orientation")).toBe(
    false
  );
});

test.each(["horizontal", "vertical"] as const)(
  "semantic %s separators expose their orientation",
  async (orientation) => {
    const ref = createRef<HTMLDivElement>();
    const container = await render(
      <Separator decorative={false} orientation={orientation} ref={ref} />
    );
    expect(ref.current).toBe(container.firstElementChild);
    expect(ref.current?.getAttribute("role")).toBe("separator");
    expect(ref.current?.getAttribute("data-orientation")).toBe(orientation);
    expect(ref.current?.getAttribute("aria-orientation")).toBe(
      orientation === "vertical" ? "vertical" : null
    );
  }
);

test("separator child composition keeps one element and caller attributes", async () => {
  const container = await render(
    <Separator aria-label="Section" asChild decorative={false}>
      <div className="custom" />
    </Separator>
  );
  expect(container.querySelectorAll("div").length).toBe(1);
  expect(container.firstElementChild?.getAttribute("aria-label")).toBe(
    "Section"
  );
  expect(container.firstElementChild?.classList.contains("custom")).toBe(true);
  expect(container.firstElementChild?.getAttribute("role")).toBe("separator");
});
