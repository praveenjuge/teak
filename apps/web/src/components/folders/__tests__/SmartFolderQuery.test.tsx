import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SmartFolderQuery } = await import("../SmartFolderQuery");

const chips = async (query: string) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() => {
    root.render(<SmartFolderQuery query={query} />);
  });
  const texts = [...container.querySelectorAll("li")].map((chip) => ({
    text: chip.textContent,
  }));
  await act(() => {
    root.unmount();
  });
  return texts;
};

describe("SmartFolderQuery", () => {
  test("shows an OR group, which has no other chip", async () => {
    expect(await chips("tag:fonts OR tag:type")).toEqual([
      { text: "tag:fonts OR tag:type" },
    ]);
  });

  test("shows exclusions after a minus, after the rest", async () => {
    expect(await chips("tag:design -is:archived -figma notes")).toEqual([
      { text: "Tagdesign" },
      { text: "notes" },
      { text: "Show−notArchived" },
      { text: "−notfigma" },
    ]);
  });
});
