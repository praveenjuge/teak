import { describe, expect, test } from "bun:test";
import type { FilesOp } from "@teak/files-protocol";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
} from "../../test/cardProcessingKit";
import { readLinkImageText } from "./linkText";

const OG_IMAGE = "users/user_1/cards/c/link-image/og.jpg";
const SCREENSHOT = "users/user_1/cards/c/screenshot/page.jpg";

const linkCard = (
  linkPreview: Record<string, unknown>,
  fields: Partial<FakeCard> = {}
) =>
  makeCard({
    metadata: { linkPreview: { status: "success", ...linkPreview } },
    type: "link",
    url: "https://example.com/talk",
    ...fields,
  });

const setup = (
  card: FakeCard,
  answers: Partial<
    Record<FilesOp, OpAnswer | ((params: Record<string, unknown>) => OpAnswer)>
  >,
  handlers: Parameters<typeof createCardConvex>[1] = {}
) => {
  const convex = createCardConvex(card, handlers);
  const fakes = createFakeOps(answers);
  const env = testEnv();
  const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
  const saved = () =>
    convex.callsTo("workflows/aiMetadata/mutations:updateCardAI").at(-1);
  return { fakes, read: () => readLinkImageText(job), saved };
};

const textOf =
  (texts: Record<string, string>) => (params: Record<string, unknown>) => ({
    data: { text: texts[params.sourceKey as string] ?? "" },
  });

describe("link image text", () => {
  test("reads the preview image, then the screenshot, and stores both", async () => {
    const { fakes, read, saved } = setup(
      linkCard({ imageStorageKey: OG_IMAGE, screenshotStorageKey: SCREENSHOT }),
      {
        "extract-image-text": textOf({
          [OG_IMAGE]: "SCALING POSTGRES\nTalk slides",
          [SCREENSHOT]: "Docs  ›  Getting started",
        }),
      }
    );
    expect(await read()).toEqual({ hasText: true, status: "read" });
    expect(fakes.calls.map((call) => call.params.sourceKey)).toEqual([
      OG_IMAGE,
      SCREENSHOT,
    ]);
    expect(saved()?.args).toEqual({
      aiOcrText: "SCALING POSTGRES\nTalk slides\n\nDocs › Getting started",
      cardId: CARD_ID,
      ocrCheckedAt: expect.any(Number),
    });
    expect(saved()?.guard).toEqual({ cardId: CARD_ID, rev: 1 });
  });

  test.each([
    ["no legible text", { data: { text: "" } }],
    ["an image it can't decode", { fallback: "UNSUPPORTED" as const }],
    ["an image that is gone", { fallback: "NOT_FOUND" as const }],
  ])("%s is read as none", async (_name, answer) => {
    const { read, saved } = setup(
      linkCard({ screenshotStorageKey: SCREENSHOT }),
      {
        "extract-image-text": answer,
      }
    );
    expect(await read()).toEqual({ hasText: false, status: "read" });
    expect(saved()?.args).toMatchObject({
      aiOcrText: "",
      ocrCheckedAt: expect.any(Number),
    });
  });

  test.each(["user_disabled", "paused"])(
    "AI %s: no image is sent and the card stays unread",
    async (gate) => {
      const { fakes, read, saved } = setup(
        linkCard({ imageStorageKey: OG_IMAGE }),
        {},
        { "adminAccess:getAiGate": () => gate }
      );
      expect(await read()).toEqual({ status: "skipped" });
      expect(fakes.calls).toEqual([]);
      expect(saved()).toBeUndefined();
    }
  );

  test.each([
    ["no images", linkCard({})],
    [
      "a card in Trash",
      linkCard({ imageStorageKey: OG_IMAGE }, { isDeleted: true }),
    ],
    ["a text card", makeCard({ content: "notes", type: "text" })],
  ])("%s is skipped", async (_name, card) => {
    const { fakes, read, saved } = setup(card, {});
    expect(await read()).toEqual({ status: "skipped" });
    expect(fakes.calls).toEqual([]);
    expect(saved()).toBeUndefined();
  });

  test("a busy Workers AI throws for the step to retry, and saves nothing", async () => {
    const { read, saved } = setup(linkCard({ imageStorageKey: OG_IMAGE }), {
      "extract-image-text": {
        throws: new Error("files_worker_ai: rate limit reached 429"),
      },
    });
    await expect(read()).rejects.toThrow("rate limit");
    expect(saved()).toBeUndefined();
  });
});
