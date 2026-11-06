import { describe, expect, test } from "bun:test";
import {
  addToFolderHref,
  cardHref,
  libraryHref,
  searchWithout,
} from "../libraryUrl";

describe("library URL", () => {
  test("opening a card keeps the search, with its commas readable", () => {
    expect(cardHref("card_9", "/favorites", "?q=blue&type=link%2Cimage")).toBe(
      "/favorites?q=blue&type=link,image&card=card_9"
    );
  });

  test("closing a card keeps the rest of the URL", () => {
    expect(cardHref(null, "/", "q=blue&card=card_9")).toBe("/?q=blue");
    expect(cardHref(null, "/trash", "card=card_9")).toBe("/trash");
  });

  test("a card opened from anywhere else opens over Everything", () => {
    expect(cardHref("card 1")).toBe("/?card=card+1");
  });

  test("leaves out the params named, and nothing else", () => {
    expect(
      libraryHref("/", searchWithout("?q=a&addTo=f1&sort=oldest", "addTo"))
    ).toBe("/?q=a&sort=oldest");
  });

  test("choosing cards for a folder starts from Everything", () => {
    expect(addToFolderHref("folder_1")).toBe("/?addTo=folder_1");
  });
});
