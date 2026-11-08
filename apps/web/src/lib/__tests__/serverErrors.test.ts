import { describe, expect, test } from "bun:test";
import { UNSUPPORTED_LOCALE_ERROR } from "@teak/convex/settings/preferences";
import * as constants from "@teak/convex/shared/constants";
import * as folders from "@teak/convex/shared/folders";
import * as pins from "@teak/convex/shared/pins";
import * as tags from "@teak/convex/shared/tags";
import * as thumbnails from "@teak/convex/shared/thumbnails";
import {
  createTeakTranslator,
  englishMessages,
  withEnglishFallback,
} from "@teak/i18n";
import german from "@teak/i18n/messages/de.json";
import { ConvexError } from "convex/values";
import {
  convexErrorData,
  serverErrorMessage,
  translateServerMessage,
} from "../serverErrors";

const { CARD_ERROR_MESSAGES } = constants;
const { FOLDER_ERROR_MESSAGES } = folders;
const { tagExistsMessage } = tags;

const english = createTeakTranslator("en", englishMessages, "errors");

// The web app shows its own words for each pin code (`isPinLimitError`).
const TRANSLATED_BY_CODE: ReadonlySet<unknown> = new Set([
  pins.PIN_ERROR_MESSAGES,
]);

/** Every `*_ERROR_MESSAGES` table the shared modules export, new ones too. */
const serverMessageTables = [constants, folders, pins, tags, thumbnails]
  .flatMap((module) => Object.entries(module))
  .filter(([name]) => name.endsWith("_ERROR_MESSAGES"))
  .map(([, table]) => table)
  .filter((table) => !TRANSLATED_BY_CODE.has(table)) as Record<
  string,
  string
>[];

describe("serverErrorMessage", () => {
  test("every server message is recognized and reads the same in English", () => {
    expect(serverMessageTables.length).toBeGreaterThanOrEqual(5);
    for (const message of [
      ...serverMessageTables.flatMap((table) => Object.values(table)),
      UNSUPPORTED_LOCALE_ERROR.message,
      tagExistsMessage(" Web design "),
    ]) {
      const error = new ConvexError({ code: "X", message });
      expect(serverErrorMessage(english, error, "fallback")).toBe(message);
      expect(translateServerMessage(english, message)).toBe(message);
    }
  });

  test("a message that names a tag keeps the name in translation", () => {
    const german = createTeakTranslator(
      "de",
      withEnglishFallback({
        errors: { tags: { TAG_EXISTS: "Das Tag „{name}“ gibt es schon." } },
      }),
      "errors"
    );
    const error = new ConvexError({
      code: "TAG_EXISTS",
      message: tagExistsMessage("Web design"),
    });
    expect(serverErrorMessage(german, error, "fallback")).toBe(
      "Das Tag „Web design“ gibt es schon."
    );
  });

  test("a known message is translated", () => {
    const german = createTeakTranslator(
      "de",
      withEnglishFallback({
        errors: { folders: { DUPLICATE_NAME: "Ordner existiert schon" } },
      }),
      "errors"
    );
    const error = new ConvexError({
      code: "DUPLICATE_NAME",
      message: FOLDER_ERROR_MESSAGES.DUPLICATE_NAME,
    });
    expect(serverErrorMessage(german, error, "fallback")).toBe(
      "Ordner existiert schon"
    );
  });

  test("a card code without a known message still translates", () => {
    const error = new ConvexError({ code: "RATE_LIMITED" });
    expect(serverErrorMessage(english, error, "fallback")).toBe(
      CARD_ERROR_MESSAGES.RATE_LIMITED
    );
  });

  test("an unknown message keeps the server's English, then the fallback", () => {
    expect(
      serverErrorMessage(
        english,
        new ConvexError({ code: "NEW", message: "Something new" }),
        "fallback"
      )
    ).toBe("Something new");
    expect(serverErrorMessage(english, new Error("boom"), "fallback")).toBe(
      "fallback"
    );
  });
});

describe("convexErrorData", () => {
  test("reads a ConvexError's code and message, and nothing else", () => {
    expect(
      convexErrorData(new ConvexError({ code: "CONFLICT", message: "Taken" }))
    ).toEqual({ code: "CONFLICT", message: "Taken" });
    expect(
      convexErrorData(new ConvexError({ code: 7, message: null }))
    ).toEqual({});
    expect(convexErrorData(new Error("network"))).toEqual({});
    expect(convexErrorData("boom")).toEqual({});
    expect(convexErrorData(undefined)).toEqual({});
  });
});

describe("folder dialog errors", () => {
  // The folder dialogs keep the server's English message, to tell which field
  // it is about, and translate it where they show it.
  const de = createTeakTranslator("de", german as never, "errors");

  test.each(Object.entries(FOLDER_ERROR_MESSAGES))(
    "%s reads in the viewer's language",
    (code, message) => {
      const kept = convexErrorData(new ConvexError({ code, message })).message;
      expect(kept).toBe(message);
      const shown = translateServerMessage(de, kept ?? "");
      expect(shown).not.toBe(message);
      expect(shown).not.toBe("");
    }
  );
});
