/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { openActionPopup } from "../../lib/actionPopup";

describe("opening the toolbar popup", () => {
  test("answers true when the popup opens", async () => {
    let opened = 0;
    const action = {
      openPopup: () => {
        opened += 1;
        return Promise.resolve();
      },
    };
    expect(await openActionPopup(action)).toBe(true);
    expect(opened).toBe(1);
  });

  test("answers false when the browser has no openPopup", async () => {
    expect(await openActionPopup({})).toBe(false);
    expect(await openActionPopup(null)).toBe(false);
  });

  test("answers false when the browser refuses outside a user action", async () => {
    const action = {
      openPopup: () => Promise.reject(new Error("needs a user gesture")),
    };
    expect(await openActionPopup(action)).toBe(false);
  });

  test("answers false when openPopup throws instead of rejecting", async () => {
    const action = {
      openPopup: (): Promise<void> => {
        throw new TypeError("not supported");
      },
    };
    expect(await openActionPopup(action)).toBe(false);
  });
});
