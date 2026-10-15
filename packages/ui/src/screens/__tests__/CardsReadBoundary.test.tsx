import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { configureClientTelemetry, resetClientTelemetry } = await import(
  "@teak/convex/shared/client-telemetry"
);
const { CardsReadBoundary } = await import("../CardsReadBoundary");
const { Component } = await import("react");

let root: Root | undefined;
// React logs every error a boundary catches; keep test output readable.
const consoleError = console.error;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  resetClientTelemetry();
  console.error = consoleError;
});

const CARDS_READ_ERROR =
  "[CONVEX Q(cards:searchCardsPaginated)] [Request ID: 0] Server Error";

/** Stands in for global-error: the app-wide screen above the library. */
// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class lifecycle.
class AppErrorScreen extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>App error screen</p> : this.props.children;
  }
}

/** A grid whose read fails while `failing` holds, like a query error. */
const renderBoundary = async (
  failing: { current: boolean },
  message = CARDS_READ_ERROR
) => {
  const keys: (string | undefined)[] = [];
  const Grid = ({ retryKey }: { retryKey: string | undefined }) => {
    if (failing.current) {
      throw new Error(message);
    }
    keys.push(retryKey);
    return <p>Cards grid</p>;
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (resetKey: string) =>
    act(() =>
      root?.render(
        <AppErrorScreen>
          <CardsReadBoundary
            headerLeading={<button type="button">Toggle sidebar</button>}
            resetKey={resetKey}
          >
            {(retryKey) => <Grid retryKey={retryKey} />}
          </CardsReadBoundary>
        </AppErrorScreen>
      )
    );
  await render("library");
  return { keys, render };
};

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name
  );

test("a failed card read shows an inline retry and keeps the header", async () => {
  console.error = mock();
  const captured = mock();
  configureClientTelemetry({ captureException: captured });

  await renderBoundary({ current: true });

  expect(document.body.textContent).toContain("Couldn't load your cards.");
  expect(button("Try again")).toBeDefined();
  expect(button("Toggle sidebar")).toBeDefined();
  expect(captured).toHaveBeenCalledTimes(1);
  expect(captured.mock.calls[0]?.[1]).toMatchObject({ "ui.boundary": "cards" });
});

test("Try again reads the cards with a new retry key", async () => {
  console.error = mock();
  const failing = { current: true };
  const { keys } = await renderBoundary(failing);

  failing.current = false;
  await act(() => button("Try again")?.click());

  expect(document.body.textContent).toContain("Cards grid");
  expect(keys.at(-1)).toEqual(expect.any(String));
});

test("opening another view clears the failure with a new retry key", async () => {
  console.error = mock();
  const failing = { current: true };
  const { keys, render } = await renderBoundary(failing);

  failing.current = false;
  await render("favorites");

  expect(document.body.textContent).toContain("Cards grid");
  expect(keys.at(-1)).toEqual(expect.any(String));
});

test("errors other than the card read go on to the app's error screen", async () => {
  console.error = mock();
  const captured = mock();
  configureClientTelemetry({ captureException: captured });

  await renderBoundary(
    { current: true },
    "[CONVEX Q(folders:getFolder)] [Request ID: 0] Server Error"
  );

  expect(document.body.textContent).toContain("App error screen");
  expect(document.body.textContent).not.toContain("Couldn't load your cards.");
  expect(captured).not.toHaveBeenCalled();
});

test("a healthy read renders the grid without a retry key", async () => {
  const { keys } = await renderBoundary({ current: false });

  expect(document.body.textContent).toContain("Cards grid");
  expect(keys).toEqual([undefined]);
});
