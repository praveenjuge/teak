import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { getReprocessErrorMessage } from "../reprocessError";

describe("getReprocessErrorMessage", () => {
  test.each([
    ["RATE_LIMITED", "This card is already refreshing. Try again in a minute."],
    ["CONFLICT", "Restore this card from Trash before refreshing it"],
    ["NOT_FOUND", "Card not found"],
  ])("shows the backend's own %s message", (code, message) => {
    expect(getReprocessErrorMessage(new ConvexError({ code, message }))).toBe(
      message
    );
  });

  test.each([
    ["a network error", new Error("fetch failed")],
    [
      "an internal ConvexError",
      new ConvexError({ code: "INTERNAL", message: "stack trace" }),
    ],
    [
      "a blank message",
      new ConvexError({ code: "RATE_LIMITED", message: " " }),
    ],
    ["a string", "boom"],
    ["nothing", undefined],
  ])("falls back to a generic line for %s", (_label, error) => {
    expect(getReprocessErrorMessage(error)).toBe(
      "Couldn't refresh this card. Try again in a moment."
    );
  });
});
