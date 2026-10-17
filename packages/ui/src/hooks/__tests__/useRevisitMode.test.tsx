import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { LibrarySort } from "../../lib/searchUrlState";
import type { UseRevisitModeOptions } from "../useRevisitMode";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRevisitMode } = await import("../useRevisitMode");

let root: Root | undefined;
let mode = {} as ReturnType<typeof useRevisitMode>;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

function Harness(props: UseRevisitModeOptions) {
  mode = useRevisitMode(props);
  return null;
}

async function mountMode(
  options: Partial<UseRevisitModeOptions> & { librarySort: LibrarySort }
) {
  const props: UseRevisitModeOptions = {
    archiveOrTrash: false,
    cardOpen: false,
    empty: false,
    replaceNextSortChange: mock(() => undefined),
    reshuffle: mock(() => undefined),
    runBulkAction: mock(() =>
      Promise.resolve({ failedIds: [], updatedIds: [] })
    ),
    setSort: mock((_sort: LibrarySort) => undefined),
    urlDriven: true,
    ...options,
  };
  root = createRoot(document.createElement("div"));
  const render = (next: Partial<UseRevisitModeOptions>) =>
    act(() => root?.render(<Harness {...props} {...next} />));
  await render({});
  return { props, render };
}

describe("useRevisitMode", () => {
  test("offers Revisit except in Archive and Trash, disabled when empty", async () => {
    const { render } = await mountMode({ librarySort: "newest" });
    expect(mode.offer).toBe("ready");
    await render({ empty: true });
    expect(mode.offer).toBe("empty");
    await render({ archiveOrTrash: true });
    expect(mode.offer).toBeUndefined();
  });

  test("never deals in Archive or Trash, even from a link", async () => {
    await mountMode({ archiveOrTrash: true, librarySort: "revisit" });
    expect(mode.revisiting).toBe(false);
  });

  test("leaving a deck picked from the menu goes Back to the order before", async () => {
    const back = mock(() => undefined);
    window.history.back = back;
    const { props, render } = await mountMode({ librarySort: "oldest" });
    await act(() => mode.onSortChange("revisit"));
    expect(props.setSort).toHaveBeenCalledWith("revisit");
    await render({ librarySort: "revisit" });

    await act(() => mode.exit());
    expect(back).toHaveBeenCalledTimes(1);
    expect(props.replaceNextSortChange).not.toHaveBeenCalled();
  });

  test("after a card's details were opened, leaving replaces the URL with the order before", async () => {
    const back = mock(() => undefined);
    window.history.back = back;
    const { props, render } = await mountMode({ librarySort: "oldest" });
    await act(() => mode.onSortChange("revisit"));
    await render({ librarySort: "revisit" });
    // Space opens the details (a pushed ?card= entry); closing replaces it.
    await render({ cardOpen: true, librarySort: "revisit" });
    await render({ cardOpen: false, librarySort: "revisit" });

    await act(() => mode.exit());
    expect(back).not.toHaveBeenCalled();
    expect(props.replaceNextSortChange).toHaveBeenCalledTimes(1);
    expect(props.setSort).toHaveBeenLastCalledWith("oldest");
  });

  test("leaving a deck opened from a link replaces the URL with the default order", async () => {
    const back = mock(() => undefined);
    window.history.back = back;
    const { props } = await mountMode({ librarySort: "revisit" });
    await act(() => mode.exit());
    expect(back).not.toHaveBeenCalled();
    expect(props.replaceNextSortChange).toHaveBeenCalledTimes(1);
    expect(props.setSort).toHaveBeenLastCalledWith("newest");
  });

  test("Start over deals a new seed without adding history", async () => {
    const { props } = await mountMode({ librarySort: "revisit" });
    await act(() => mode.startOver());
    expect(props.replaceNextSortChange).toHaveBeenCalledTimes(1);
    expect(props.reshuffle).toHaveBeenCalledTimes(1);
  });

  test("archives through the bulk actions; Z's unarchive stays quiet", async () => {
    const runBulkAction = mock((_action: string, cardIds: string[]) =>
      Promise.resolve({
        failedIds: cardIds[0] === "bad" ? cardIds : [],
        updatedIds: cardIds[0] === "bad" ? [] : cardIds,
      })
    );
    await mountMode({ librarySort: "revisit", runBulkAction });
    expect(await mode.onArchive("c1")).toBe(true);
    expect(await mode.onArchive("bad")).toBe(false);
    expect(await mode.onUnarchive("c1")).toBe(true);
    expect(runBulkAction.mock.calls).toEqual([
      ["archive", ["c1"]],
      ["archive", ["bad"]],
      ["unarchive", ["c1"], { silent: true }],
    ]);
  });
});
