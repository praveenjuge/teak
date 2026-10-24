import { describe, expect, test } from "bun:test";
import { CARD_ERROR_MESSAGES } from "@teak/convex/shared/constants";
import { FOLDER_ERROR_MESSAGES } from "@teak/convex/shared/folders";
import { TAG_ERROR_MESSAGES } from "@teak/convex/shared/tags";
import { THUMBNAIL_ERROR_MESSAGES } from "@teak/convex/shared/thumbnails";
import {
  createTeakTranslator,
  englishMessages,
  withEnglishFallback,
} from "@teak/i18n";
import { ConvexError } from "convex/values";
import { serverErrorMessage } from "../serverErrors";

const english = createTeakTranslator("en", englishMessages, "errors");

describe("serverErrorMessage", () => {
  test("every server message is recognized and reads the same in English", () => {
    for (const message of [
      ...Object.values(FOLDER_ERROR_MESSAGES),
      ...Object.values(TAG_ERROR_MESSAGES),
      ...Object.values(THUMBNAIL_ERROR_MESSAGES),
      ...Object.values(CARD_ERROR_MESSAGES),
    ]) {
      const error = new ConvexError({ code: "X", message });
      expect(serverErrorMessage(english, error, "fallback")).toBe(message);
    }
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
