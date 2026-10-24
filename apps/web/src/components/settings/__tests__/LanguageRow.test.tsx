import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageRow } from "../LanguageRow";

const render = (locale: "en" | "de" | "ja" | "en-XA") =>
  renderToStaticMarkup(
    <LanguageRow
      locale={locale}
      onChange={mock(() => undefined)}
      pending={false}
    />
  );

describe("LanguageRow", () => {
  test("shows the chosen language in its own name", () => {
    expect(render("de")).toContain(">Deutsch<");
    expect(render("ja")).toContain(">日本語<");
    expect(render("en")).toContain(">English<");
  });

  test("the development pseudo-locale shows as English", () => {
    expect(render("en-XA")).toContain(">English<");
  });

  test("the feedback link names the language in the subject", () => {
    expect(render("de")).toContain(
      `href="mailto:hello@praveenjuge.com?subject=${encodeURIComponent(
        "Translation feedback (de)"
      )}"`
    );
    expect(render("de")).toContain("Help improve translations");
  });

  test("the select has an accessible name", () => {
    expect(render("en")).toContain('aria-label="Language"');
  });
});
