import { describe, expect, test } from "bun:test";
import {
  isOnboardingCard,
  LEGACY_ONBOARDING_CARD_CONTENTS,
  ONBOARDING_CARDS,
  type OnboardingCardDef,
} from "../../card/defaultCards";
import { validateTextCardContent } from "../../card/markdown";
import { ONBOARDING_FILES } from "../../card/onboarding/files";
import { validateFileFormat } from "../../shared/fileFormats";

describe("getting-started cards", () => {
  test("cover every card type once", () => {
    expect(ONBOARDING_CARDS.map((card) => card.type).sort()).toEqual(
      [
        "audio",
        "document",
        "image",
        "link",
        "palette",
        "quote",
        "text",
        "video",
      ].sort()
    );
    expect(new Set(ONBOARDING_CARDS.map((card) => card.onboarding)).size).toBe(
      ONBOARDING_CARDS.length
    );
  });

  // A file card whose bytes are missing, or whose format uploads would
  // refuse, never reaches a new account.
  test.each(
    ONBOARDING_CARDS.filter((card) => card.file).map(
      (card): [string, OnboardingCardDef] => [card.onboarding, card]
    )
  )(
    "the %s card's file is embedded and accepted as its card type",
    (_: string, card: OnboardingCardDef) => {
      const file = card.file!;
      expect(ONBOARDING_FILES[file.source]?.length).toBeGreaterThan(1000);
      expect(
        validateFileFormat({ fileName: file.name, mimeType: file.mimeType })
          .cardType
      ).toBe(card.type);
    }
  );

  test("the welcome card is valid text card content", () => {
    const welcome = ONBOARDING_CARDS.find((card) => card.type === "text")!;
    expect(validateTextCardContent(welcome.content)).toBe(welcome.content);
  });
});

describe("isOnboardingCard", () => {
  type Case = [string, { content: string; onboarding?: string }, boolean];
  const cases: Case[] = [
    ["a new getting-started card", { content: "", onboarding: "image" }, true],
    [
      "a card from the first onboarding set",
      { content: LEGACY_ONBOARDING_CARD_CONTENTS[0]! },
      true,
    ],
    ["a card someone saved", { content: "Sunset palette ideas" }, false],
  ];
  test.each(cases)("%s", (_: string, card: Case[1], expected: boolean) => {
    expect(isOnboardingCard(card)).toBe(expected);
  });
});
