import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const captured: unknown[] = [];
mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: (error: unknown) => captured.push(error),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { RootError } = await import("../RootError");

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("Try again runs the failed page load again and shows the page", async () => {
  let loads = 0;
  const failure = new Error("Convex is unreachable");
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: createRootRoute({
      loader: () => {
        loads += 1;
        if (loads === 1) {
          throw failure;
        }
        return "ok";
      },
      component: () => <p>The page</p>,
      errorComponent: RootError,
    }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<RouterProvider router={router} />);
    await router.load();
  });
  expect(container.textContent).toContain("Something went wrong");
  expect(captured).toContain(failure);

  const tryAgain = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again"
  );
  await act(async () => {
    tryAgain?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(loads).toBe(2);
  expect(container.textContent).toBe("The page");
});
