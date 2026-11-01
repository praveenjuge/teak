import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageRow, languageSecondaryNames } from "../LanguageRow";

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

  test("the select has an accessible name", () => {
    expect(render("en")).toContain('aria-label="Language"');
  });
});

describe("languageSecondaryNames", () => {
  test("names each language in the UI's language", () => {
    const german = languageSecondaryNames("de");
    expect(german.en).toBe("Englisch");
    expect(german.fr).toBe("Französisch");
    expect(german["zh-Hans"]).toBe("Chinesisch (Vereinfacht)");
    const english = languageSecondaryNames("en");
    expect(english.de).toBe("German");
    expect(english["pt-BR"]).toBe("Portuguese (Brazil)");
  });

  test("leaves out a name that repeats the language's own", () => {
    expect(languageSecondaryNames("de").de).toBeNull();
    expect(languageSecondaryNames("en").en).toBeNull();
    expect(languageSecondaryNames("ja").ja).toBeNull();
  });
});
