import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderToString } from "react-dom/server";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { hydrateRoot } = await import("react-dom/client");
const { useHydrated } = await import("../useHydrated");

function Probe() {
  return <span>{useHydrated() ? "hydrated" : "server"}</span>;
}

test("reads false on the server and true once the client has hydrated", async () => {
  const html = renderToString(<Probe />);
  expect(html).toContain("server");

  const container = document.createElement("div");
  container.innerHTML = html;
  const root = await act(() => hydrateRoot(container, <Probe />));
  expect(container.textContent).toBe("hydrated");
  await act(() => root.unmount());
});
