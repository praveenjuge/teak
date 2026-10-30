import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { isOnboardingSourceName } from "@teak/files-protocol";
import {
  finishOnboardingCard,
  isOnboardingCard,
  LEGACY_ONBOARDING_CARD_CONTENTS,
  ONBOARDING_CARDS,
  type OnboardingCardDef,
} from "../../card/defaultCards";
import { validateTextCardContent } from "../../card/markdown";
import { validateFileFormat } from "../../shared/fileFormats";

const WORKER_ONBOARDING_ASSETS = join(
  import.meta.dir,
  "../../../../apps/core-worker/assets/onboarding"
);

describe("getting-started cards", () => {
  test("cover every card type once", () => {
    expect(ONBOARDING_CARDS.map((card): string => card.type).sort()).toEqual(
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

  test.each(
    ONBOARDING_CARDS.filter((card) => card.uploads).map(
      (card): [string, OnboardingCardDef] => [card.onboarding, card]
    )
  )(
    "the %s card's files ship with the Core Worker and its original fits its card type",
    (_: string, card: OnboardingCardDef) => {
      for (const upload of card.uploads ?? []) {
        expect(isOnboardingSourceName(upload.source)).toBe(true);
        expect(
          statSync(join(WORKER_ONBOARDING_ASSETS, upload.source)).size
        ).toBeGreaterThan(1000);
      }
      const original = card.uploads?.find((upload) => upload.slot === "file");
      if (original) {
        expect(
          validateFileFormat({
            fileName: original.name,
            mimeType: original.mimeType,
          }).cardType
        ).toBe<string>(card.type);
      }
    }
  );

  test("the welcome card is valid text card content", () => {
    const welcome = ONBOARDING_CARDS.find((card) => card.type === "text")!;
    expect(validateTextCardContent(welcome.content)).toBe(welcome.content);
  });
});

describe("finishOnboardingCard", () => {
  const def = (onboarding: string) =>
    ONBOARDING_CARDS.find((card) => card.onboarding === onboarding)!;

  test("puts a video's stored original, poster, and scrub strip on the card", () => {
    const card = finishOnboardingCard(
      def("video"),
      {
        onboarding: "video",
        fileSize: 42,
        keys: { file: "k/file", thumbnail: "k/thumb", scrub: "k/scrub" },
      },
      5
    );

    expect(card).toMatchObject({
      fileKey: "k/file",
      thumbnailKey: "k/thumb",
      scrubKey: "k/scrub",
      fileMetadata: { width: 1920, height: 1200, fileSize: 42 },
    });
    expect(card?.runProcessing).toBeUndefined();
  });

  test("a file card missing a stored file is left out", () => {
    expect(
      finishOnboardingCard(
        def("video"),
        { onboarding: "video", keys: { file: "k/file" } },
        5
      )
    ).toBeNull();
  });

  test("a link gets its stored preview, or is processed when it has none", () => {
    const finished = finishOnboardingCard(
      def("link"),
      {
        onboarding: "link",
        keys: { linkImage: "k/image", screenshot: "k/shot" },
      },
      5
    );
    expect(finished?.metadata?.linkPreview).toMatchObject({
      imageStorageKey: "k/image",
      screenshotStorageKey: "k/shot",
      fetchedAt: 5,
    });

    const unprocessed = finishOnboardingCard(def("link"), undefined, 5);
    expect(unprocessed).toMatchObject({
      runProcessing: true,
      url: "https://teakvault.com/apps",
    });
    expect(unprocessed?.metadata).toBeUndefined();
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
