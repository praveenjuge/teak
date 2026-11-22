import { describe, expect, test } from "bun:test";
import { loadMessages } from "@teak/i18n";
import { pageTitle, titleHead } from "../pageTitle";

const titleOf = (head: ReturnType<ReturnType<typeof titleHead>>) =>
  head.meta[0]?.title;

describe("tab titles", () => {
  test("a page without a name is just Teak", () => {
    expect(pageTitle()).toBe("Teak");
    expect(titleOf(titleHead()({ matches: [] }))).toBe("Teak");
  });

  test("name the page in the language the signed-in layout loaded", async () => {
    const session = { locale: "de", messages: await loadMessages("de") };
    const head = titleHead((t) =>
      t("settings.header.subpageTitle", { page: t("settings.nav.security") })
    );
    expect(titleOf(head({ matches: [{}, { loaderData: session }] }))).toBe(
      "Sicherheit · Einstellungen · Teak"
    );
  });

  test("fall back to English before the session has loaded", () => {
    const head = titleHead((t) => t("lib.libraryViews.labels.trash"));
    expect(titleOf(head({ matches: [{ loaderData: undefined }] }))).toBe(
      "Trash · Teak"
    );
  });
});
