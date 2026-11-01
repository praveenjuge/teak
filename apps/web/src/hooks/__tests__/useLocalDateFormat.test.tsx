import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

const { act } = await import("react");
const { hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { useLocalDateFormat } = await import("../useLocalDateFormat");

const FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
};
const SAVED_AT = Date.UTC(2026, 9, 31, 23, 30);

function SavedAt() {
  const formatDate = useLocalDateFormat(FORMAT);
  return <p>{formatDate ? `Saved ${formatDate(SAVED_AT)}` : "Saved"}</p>;
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("leaves the date out of the server's HTML, then fills it in once hydrated", async () => {
  const html = renderToString(<SavedAt />);
  expect(html).toBe("<p>Saved</p>");

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const recoverable: unknown[] = [];
  const root = await act(() =>
    hydrateRoot(container, <SavedAt />, {
      onRecoverableError: (error) => recoverable.push(error),
    })
  );

  expect(recoverable).toEqual([]);
  expect(container.textContent).toMatch(/^Saved Oct 31, 2026.+11:30\sPM$/);
  await act(() => root.unmount());
});
