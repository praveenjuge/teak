import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderToStaticMarkup } from "react-dom/server";
import { SmartFolderQuery } from "../SmartFolderQuery";

GlobalRegistrator.register({ url: "http://localhost:3000" });

const chips = (query: string) => {
  const html = renderToStaticMarkup(<SmartFolderQuery query={query} />);
  const list = new DOMParser().parseFromString(html, "text/html");
  return [...list.querySelectorAll("li")].map((chip) => ({
    text: chip.textContent,
  }));
};

describe("SmartFolderQuery", () => {
  test("shows an OR group, which has no other chip", () => {
    expect(chips("tag:fonts OR tag:type")).toEqual([
      { text: "tag:fonts OR tag:type" },
    ]);
  });

  test("shows exclusions after a minus, after the rest", () => {
    expect(chips("tag:design -is:archived -figma notes")).toEqual([
      { text: "Tagdesign" },
      { text: "notes" },
      { text: "Show−notArchived" },
      { text: "−notfigma" },
    ]);
  });
});
