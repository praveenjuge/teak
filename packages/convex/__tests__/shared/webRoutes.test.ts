import { describe, expect, test } from "bun:test";
import { CARD_PARAM, cardAppUrl } from "../../shared/webRoutes";

describe("cardAppUrl", () => {
  test("opens the card in the library at the app's address", () => {
    const url = new URL(cardAppUrl("https://app.example/", "k57 card"));
    expect(url.origin).toBe("https://app.example");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get(CARD_PARAM)).toBe("k57 card");
  });
});
