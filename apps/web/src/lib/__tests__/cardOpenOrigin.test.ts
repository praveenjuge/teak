import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { readCardOpenOrigin, rememberCardOpenOrigin } from "../cardOpenOrigin";

const viewport = { width: 1000, height: 800 };

afterEach(() => {
  setSystemTime();
});

describe("card open origin", () => {
  test("grows the dialog from the centre of the card that opened it", () => {
    setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    rememberCardOpenOrigin("card_a", {
      left: 100,
      top: 200,
      width: 200,
      height: 100,
    });
    expect(readCardOpenOrigin("card_a", viewport)).toBe("20.0% 31.3%");
  });

  test("ignores an origin from another card or from long ago", () => {
    setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    rememberCardOpenOrigin("card_a", {
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    });
    expect(readCardOpenOrigin("card_b", viewport)).toBeUndefined();
    setSystemTime(new Date(2026, 0, 1, 12, 0, 5));
    expect(readCardOpenOrigin("card_a", viewport)).toBeUndefined();
  });

  test("keeps the origin on screen for a card scrolled partly out of view", () => {
    setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    rememberCardOpenOrigin("card_a", {
      left: 900,
      top: -400,
      width: 400,
      height: 100,
    });
    expect(readCardOpenOrigin("card_a", viewport)).toBe("100.0% 0.0%");
  });
});
