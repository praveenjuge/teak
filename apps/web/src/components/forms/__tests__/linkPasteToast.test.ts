import { describe, expect, test } from "bun:test";
import {
  createTeakTranslator,
  englishMessages,
  withEnglishFallback,
} from "@teak/i18n";
import german from "@teak/i18n/messages/de.json";
import { type LinkPasteProgress, linkPasteToast } from "../linkPasteToast";

const t = createTeakTranslator("en", englishMessages, "forms.pasteLinks");
const de = createTeakTranslator(
  "de",
  withEnglishFallback(german),
  "forms.pasteLinks"
);

const progress = (
  overrides: Partial<LinkPasteProgress> = {}
): LinkPasteProgress => ({
  status: "done",
  total: 12,
  processed: 12,
  created: 12,
  resaved: 0,
  failed: 0,
  omittedOverLimit: 0,
  omittedRepeats: 0,
  ...overrides,
});

describe("the pasted links toast", () => {
  test.each([
    [progress(), "Saved 12 links"],
    [progress({ created: 1, total: 1 }), "Saved 1 link"],
    [
      progress({ created: 9, resaved: 3 }),
      "Saved 9 links · 3 already in Teak, moved to the top",
    ],
    [
      progress({ created: 10, failed: 2 }),
      "Saved 10 links · 2 couldn't be saved",
    ],
    [
      progress({ total: 100, created: 100, omittedOverLimit: 37 }),
      "Saved 100 links · 37 left out (100 at a time)",
    ],
    [
      progress({ created: 8, resaved: 1, failed: 1, omittedOverLimit: 2 }),
      "Saved 8 links · 1 already in Teak, moved to the top · 1 couldn't be saved · 2 left out (100 at a time)",
    ],
  ])("ends a finished job with what it saved", (job, message) => {
    expect(linkPasteToast(job, 0, t)).toEqual({ kind: "success", message });
  });

  test("counts lines the composer never sent as left out", () => {
    expect(
      linkPasteToast(
        progress({ total: 100, created: 100, omittedOverLimit: 900 }),
        200,
        t
      ).message
    ).toBe("Saved 100 links · 1,100 left out (100 at a time)");
  });

  test("shows progress while the job runs", () => {
    expect(
      linkPasteToast(
        progress({ status: "running", processed: 8, created: 8 }),
        0,
        t
      )
    ).toEqual({ kind: "loading", message: "Saving links · 8 of 12" });
  });

  test("ends at the card limit with what was saved before it", () => {
    expect(
      linkPasteToast(
        progress({ status: "stopped_at_limit", created: 3, resaved: 1 }),
        0,
        t
      )
    ).toEqual({
      kind: "limit",
      message: "Saved 4 of 12 links · You've reached 200 cards",
    });
  });

  test("says a failed job couldn't save the links", () => {
    expect(linkPasteToast(progress({ status: "failed" }), 0, t)).toEqual({
      kind: "error",
      message: "Couldn't save the links. Try again.",
    });
  });

  test("speaks the account's language", () => {
    expect(
      linkPasteToast(progress({ created: 9, resaved: 3 }), 0, de).message
    ).toBe(
      "9 Links gespeichert · 3 waren bereits in Teak und wurden nach oben verschoben"
    );
  });
});
