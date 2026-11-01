import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({
    settings: { disableIframePageLoading: true },
    url: "https://app.teakvault.com/open/k1",
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArchiveFrame, ArchivedCopyBar, ArchivedCopyView, ArchiveMissing } =
  await import("../ArchivedCopyView");

const COPY = {
  capturedAt: Date.UTC(2026, 9, 19, 12),
  cardId: "k1",
  host: "example.com",
  url: "https://www.example.com/gone",
};
const ARCHIVE_URL =
  "https://files.teakvault.com/users/u/cards/k1/page-archive/a-archive.html?exp=1&sig=s";

describe("the archived copy's frame", () => {
  test("loads the copy sandboxed, with no scripts, no same origin and no referrer", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <ArchiveFrame host="example.com" src={ARCHIVE_URL} />
    );
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe(
      "allow-popups allow-popups-to-escape-sandbox"
    );
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("src")).toBe(ARCHIVE_URL);
    expect(frame?.getAttribute("title")).toBe("Archived copy of example.com");
  });
});

describe("the archived copy's bar", () => {
  const bar = () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ArchivedCopyBar {...COPY} />);
    return container;
  };

  test("names the copy, says the page is gone, and when and where it was saved", () => {
    const container = bar();
    expect(container.querySelector("h1")?.textContent).toBe("Archived copy");
    expect(container.textContent).toContain(
      "This page is no longer available · Saved Oct 19, 2026 from example.com"
    );
    expect(container.textContent).toContain("No longer available");
  });

  test("offers the original and the card in Teak, beside and in the ⋯ menu", () => {
    const container = bar();
    const links = [...container.querySelectorAll("a")].map((anchor) => [
      anchor.textContent,
      anchor.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["Try the original ↗", COPY.url],
      ["Open in Teak", "/?card=k1"],
    ]);
    expect(
      container.querySelector('button[aria-label="More actions"]')
    ).not.toBeNull();
  });

  test("says when Teak's copy is missing, and offers the original", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <ArchiveMissing url={COPY.url} />
    );
    expect(container.textContent).toContain("Teak’s copy couldn’t be loaded.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(COPY.url);
  });
});

describe("the archive view", () => {
  let root: Root | undefined;
  const realFetch = globalThis.fetch;
  const requests: Array<{ method?: string; url: string }> = [];

  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    globalThis.fetch = realFetch;
    requests.length = 0;
  });

  const show = async (status: number | "offline", archiveUrl = ARCHIVE_URL) => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method, url: String(input) });
      return status === "offline"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(null, { status }));
    }) as typeof fetch;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ArchivedCopyView {...COPY} archiveUrl={archiveUrl} />);
      await Promise.resolve();
    });
    return container;
  };

  test("shows the copy once its object answers", async () => {
    const container = await show(200);
    expect(requests).toEqual([{ method: "HEAD", url: ARCHIVE_URL }]);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      ARCHIVE_URL
    );
  });

  test.each([[404 as const], [403 as const], ["offline" as const]])(
    "says the copy couldn't be loaded when its object answers %s",
    async (status) => {
      const container = await show(status);
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).toContain(
        "Teak’s copy couldn’t be loaded."
      );
    }
  );

  test("says the copy couldn't be loaded when there is no URL for it", async () => {
    globalThis.fetch = realFetch;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root?.render(<ArchivedCopyView {...COPY} />));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Teak’s copy couldn’t be loaded.");
  });
});
