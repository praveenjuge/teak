import { describe, expect, test } from "bun:test";
import { appEntryScript } from "./app-entry";
import { headerVisibilityProblems } from "./header-visibility";

const script = `<script>${appEntryScript()}</script>`;
const links =
  '<a data-signed-out-only href="/sign-in">Login</a><a data-signed-in-only href="/">Open Teak</a>';
const rule =
  "html[data-signed-in] [data-signed-out-only],html:not([data-signed-in]) [data-signed-in-only]{display:none}";

describe("header link visibility", () => {
  test("a page with the script before the links and the hide rule passes", () => {
    expect(
      headerVisibilityProblems(script + links, `a{color:red}${rule}`)
    ).toEqual([]);
  });

  test("the hide rule inlined in <head> isn't mistaken for the links", () => {
    expect(
      headerVisibilityProblems(`<style>${rule}</style>${script}${links}`, rule)
    ).toEqual([]);
  });

  test("a docs page without the site's stylesheet is caught", () => {
    expect(headerVisibilityProblems(script + links, "a{color:red}")).toEqual([
      "no CSS rule hides [data-signed-in-only]",
      "no CSS rule hides [data-signed-out-only]",
    ]);
  });

  test("a page without the script, or with it after the links, is caught", () => {
    const missing = [
      "no session hint script before the header links (appEntryScript)",
    ];
    expect(headerVisibilityProblems(links, rule)).toEqual(missing);
    expect(headerVisibilityProblems(links + script, rule)).toEqual(missing);
  });

  test("a rule naming the links without hiding them doesn't count", () => {
    expect(
      headerVisibilityProblems(
        script + links,
        "[data-signed-in-only],[data-signed-out-only]{color:red}"
      )
    ).toHaveLength(2);
  });

  test("a page without the header links needs nothing", () => {
    expect(headerVisibilityProblems("<main>Docs</main>", "")).toEqual([]);
  });
});
