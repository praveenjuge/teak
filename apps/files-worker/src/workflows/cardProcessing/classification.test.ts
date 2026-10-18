import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { TEST_CONVEX_SITE_URL } from "../../test/fakeConvex";
import { callFilesOp } from "../filesOps";
import { classifyCard } from "./classification";
import type { CardJob } from "./context";

const NO_DECISION = {
  decision: null,
  model: "@cf/cloudflare/clef-flash",
  version: 1,
};

let given: Record<string, unknown> | null | undefined = null;
const givenCard = (card: Record<string, unknown> | null | undefined) => {
  given = card;
};

const classify = async (mutations: ReturnType<typeof mock>) => {
  const card = given
    ? ({ userId: USER_ID, ...given } as unknown as FakeCard)
    : null;
  const convex = createCardConvex(card);
  const env = testEnv();
  const job: CardJob = {
    cardId: (card?._id ?? "c1") as CardJob["cardId"],
    convexSiteUrl: TEST_CONVEX_SITE_URL,
    deps: testDeps(
      env,
      convex.fetcher,
      createFakeOps({ "decide-card-type": { data: NO_DECISION } }).ops
    ),
    env,
    rev: 0,
  };
  const result = await classifyCard(job);
  for (const call of convex.calls) {
    if (
      call.kind === "mutation" &&
      call.name !== "card/processingRpc:markStagesInProgress"
    ) {
      mutations(call.name, call.args);
    }
  }
  return result;
};

const classifyCompletedWith = async (mutations: ReturnType<typeof mock>) => {
  const result = await classify(mutations);
  if (result.mode !== "completed") {
    throw new Error(`expected a completed classification, got ${result.mode}`);
  }
  return result;
};

describe("classification step", () => {
  const mockRunMutation = mock();

  beforeEach(() => {
    given = null;
    mockRunMutation.mockReset();
  });

  describe("classification error handling", () => {
    test("skips when card was deleted before classification", async () => {
      givenCard(null);

      await expect(classify(mockRunMutation)).resolves.toEqual({
        mode: "skipped",
      });
      expect(mockRunMutation).not.toHaveBeenCalled();
    });

    test("treats an undefined card as the same deletion race", async () => {
      givenCard(undefined);

      await expect(classify(mockRunMutation)).resolves.toEqual({
        mode: "skipped",
      });
      expect(mockRunMutation).not.toHaveBeenCalled();
    });
  });

  describe("quote classification stickiness", () => {
    test("preserves quote type when no conflicting signals", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        content: "to be or not to be",
        processingStatus: {
          classify: { status: "completed", confidence: 0.95 },
        },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.mode).toBe("completed");
      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
      expect(result.shouldCategorize).toBe(false);
      expect(result.shouldGenerateRenderables).toBe(false);
      expect(result.needsLinkMetadata).toBe(false);
      expect(mockRunMutation.mock.calls).toEqual([
        [
          "workflows/steps/classificationMutations:recordClassification",
          { cardId: "c1", confidence: 0.95 },
        ],
      ]);
    });

    test("preserves quote with default confidence", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        content: "test",
        processingStatus: {},
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
    });

    test("marks classify completed for a sticky quote card with a pending stage", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        content: "to be or not to be",
        processingStatus: { classify: { status: "pending" } },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.mode).toBe("completed");
      expect(result.type).toBe("quote");
      expect(mockRunMutation).toHaveBeenCalledTimes(1);
      expect(mockRunMutation.mock.calls[0][1]).toEqual({
        cardId: "c1",
        confidence: 0.95,
      });
    });

    test("re-classifies quote when URL present", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        url: "https://example.com",
      };
      givenCard(card);

      await classify(mockRunMutation);

      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("re-classifies quote when fileKey present", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        fileKey: "f1",
      };
      givenCard(card);

      await classify(mockRunMutation);

      expect(mockRunMutation).toHaveBeenCalled();
    });
  });

  describe("quote heuristic detection", () => {
    test("detects quote from quoted content", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: '"This is a quote" - Author',
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("detects single quote marks", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "'This is a quote'",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("quote");
    });

    test("detects markdown blockquotes", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "> This is a blockquote",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
    });

    test("does not detect quote when URL present", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: '"quoted text"',
        url: "https://example.com",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).not.toBe("quote");
    });
  });

  describe("MIME type classification", () => {
    test("classifies image MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("image");
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("classifies video MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "video/mp4" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("video");
    });

    test("classifies audio MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "audio/mpeg" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("audio");
    });

    test("classifies PDF documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "application/pdf" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("document");
    });

    test("classifies Word documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: {
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("document");
    });
  });

  describe("file metadata classification", () => {
    test("classifies by duration as video when dimensions present", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { duration: 120, width: 1920, height: 1080 },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("video");
    });

    test("classifies by duration as audio without dimensions", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { duration: 180 },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("audio");
    });

    test("classifies by dimensions as image", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { width: 800, height: 600 },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("image");
    });
  });

  describe("URL extension classification", () => {
    test("classifies image by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/image.png",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });

    test("classifies video by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/video.mp4",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });

    test("classifies audio by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/audio.mp3",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });

    test("handles URLs without extensions", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/page",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });
  });

  describe("palette detection", () => {
    test("detects palette from multiple colors", async () => {
      const card = {
        _id: "c1",
        content: "#ff0000 #00ff00 #0000ff",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
      expect(result.confidence).toBe(0.88);
    });

    test("detects palette from a single hex color", async () => {
      const card = {
        _id: "c1",
        content: "#2050D0",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
      expect(result.confidence).toBe(0.88);
    });

    test("detects palette from color names", async () => {
      const card = {
        _id: "c1",
        content: "red green blue",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test("detects palette from tags", async () => {
      const card = {
        _id: "c1",
        content: "#ff0000",
        tags: ["colors", "palette"],
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test("detects palette from hint keywords", async () => {
      const card = {
        _id: "c1",
        content: "My brand colors palette",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
    });

    test("keeps prose that mentions a colour word as text", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "Bathroom ideas: dark green tiles, oak shelves, brass taps.",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
      expect(mockRunMutation).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "palette" })
      );
    });

    test("keeps prose with a single hex-like reference as text", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "Follow up on issue #123 before Friday",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
    });

    test("detects a labelled colour list as palette", async () => {
      const card = {
        _id: "c1",
        content: "Primary: #0F4C81\nAccent: dark green",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test.each([
      "rgb(255, 87, 51)",
      "hsl(120, 100%, 50%)",
      "--accent: rgb(1, 2, 3);",
    ])("detects a lone functional colour %p as palette", async (content) => {
      givenCard({ _id: "c1", content });

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test.each([
      "Fixed #123 and #456 before the release",
      "Ticket: #1234",
      "#123, #456",
      "Use rgb(255, 87, 51) for buttons",
      "Brand colors are tracked in #123",
    ])("keeps prose %p as text", async (content) => {
      givenCard({ _id: "c1", type: "text", content });

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
    });

    test.each([
      "light blue red",
      "--bg-primary: #FF5733",
      "--color-component-button-background-primary: #FF5733",
      "#000, #333",
    ])("detects %p as palette", async (content) => {
      givenCard({ _id: "c1", content });

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test("classifies a long note of unclosed rgb( without stalling", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "rgb(".repeat(50_000),
      };
      givenCard(card);

      const startedAt = performance.now();
      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
      expect(performance.now() - startedAt).toBeLessThan(1000);
    });

    test("classifies a long comma-separated note without stalling", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "a,".repeat(100_000),
      };
      givenCard(card);

      const startedAt = performance.now();
      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
      expect(performance.now() - startedAt).toBeLessThan(1000);
    });

    test("stores multi-word colour names as the colours they name", async () => {
      givenCard({
        _id: "c1",
        type: "text",
        content: "light blue, dark green, mint cream",
      });

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
      const colorUpdate = mockRunMutation.mock.calls.find(
        ([, args]) => args?.colors
      );
      expect(
        colorUpdate?.[1].colors.map((color: { hex: string }) => color.hex)
      ).toEqual(["#ADD8E6", "#006400", "#F5FFFA"]);
    });

    test("detects named colours with a palette hint as palette", async () => {
      const card = {
        _id: "c1",
        content: "Brand colors: navy and gold",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test("detects prose with several colour codes as palette", async () => {
      const card = {
        _id: "c1",
        content: "Use #0F4C81 for headings and #FF5500 for buttons",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
    });

    test("does not detect palette with URL present", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "palette colors red green blue",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });
  });

  describe("URL-only card handling", () => {
    test("forces link type for URL-only card", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "https://example.com",
        type: "text",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("forces link type for empty content with URL", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "",
        type: "text",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
    });

    test("classifies content-only bare URL as link when url field is set", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
        url: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("link");
      expect(result.shouldCategorize).toBe(true);
      expect(result.needsLinkMetadata).toBe(true);
    });

    test("preserves non-link type with additional content", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/image.png",
        content: "Check out this image",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("image");
    });
  });

  describe("markdown and color-list regressions", () => {
    test("keeps Markdown notes as text even when a heading looks like a hex", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "# Heading\n\n- [ ] task\n\n| A | B |\n| - | - |\n| 1 | 2 |",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("text");
      expect(result.shouldGenerateRenderables).toBe(false);
    });

    test("detects a comma-separated color list as palette", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "#ff00aa, #00ffaa, rgb(0, 10, 20)",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.type).toBe("palette");
      expect(result.confidence).toBe(0.88);
    });
  });

  describe("workflow flags", () => {
    test("sets shouldCategorize only for links", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldCategorize).toBe(true);
    });

    test("does not categorize non-link cards", async () => {
      const card = {
        _id: "c1",
        content: "plain text",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldCategorize).toBe(false);
    });

    test("always shouldGenerateMetadata", async () => {
      const card = {
        _id: "c1",
        content: "test",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldGenerateMetadata).toBe(true);
    });

    test("shouldGenerateRenderables for images", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("shouldGenerateRenderables for videos", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "video/mp4" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("shouldGenerateRenderables for documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "application/pdf" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("should not generate renderables for text", async () => {
      const card = {
        _id: "c1",
        content: "plain text",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.shouldGenerateRenderables).toBe(false);
    });

    test("needsLinkMetadata for links without preview", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.needsLinkMetadata).toBe(true);
    });

    test("does not need link metadata with successful preview", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success" } },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.needsLinkMetadata).toBe(false);
    });
  });

  describe("confidence normalization", () => {
    test("clamps confidence to maximum 1.0", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" },
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    test("clamps confidence to minimum 0.0", async () => {
      const card = {
        _id: "c1",
        content: "test",
      };
      givenCard(card);

      const result = await classifyCompletedWith(mockRunMutation);

      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
    });
  });
});

describe("classification stage completion", () => {
  const mockRunMutation = mock();

  beforeEach(() => {
    given = null;
    mockRunMutation.mockReset();
  });

  test("marks classify completed when re-classification confirms the existing type", async () => {
    const card = {
      _id: "c1",
      type: "link",
      url: "https://example.com/page",
      content: "https://example.com/page",
      processingStatus: { classify: { status: "pending" } },
    };
    givenCard(card);

    const result = await classifyCompletedWith(mockRunMutation);

    expect(result.mode).toBe("completed");
    expect(result.type).toBe("link");
    expect(mockRunMutation).toHaveBeenCalledTimes(1);
    expect(mockRunMutation.mock.calls[0][1]).toEqual({
      cardId: "c1",
      confidence: expect.any(Number),
    });
  });

  test("records the stage it marked in progress without changing the type", async () => {
    const card = {
      _id: "c1",
      type: "link",
      url: "https://example.com/page",
      content: "https://example.com/page",
      processingStatus: {
        classify: { status: "completed", confidence: 0.9 },
      },
    };
    givenCard(card);

    const result = await classifyCompletedWith(mockRunMutation);

    expect(result.mode).toBe("completed");
    expect(result.type).toBe("link");
    expect(mockRunMutation.mock.calls).toEqual([
      [
        "workflows/steps/classificationMutations:recordClassification",
        { cardId: "c1", confidence: 0.9 },
      ],
    ]);
  });
});

describe("card type review by Clef", () => {
  const review = async (
    fields: { content: string; type?: string; url?: string },
    options: {
      choice?: string | Error;
      gate?: string;
      probability?: number;
    } = {}
  ) => {
    const card = makeCard({ ...fields, type: fields.type ?? "text" });
    const convex = createCardConvex(card, {
      "adminAccess:getAiGate": () => options.gate ?? "allowed",
    });
    const aiCalls: Record<string, unknown>[] = [];
    const points: AnalyticsEngineDataPoint[] = [];
    const env = testEnv({
      AI: {
        run: (_model: string, args: Record<string, unknown>) => {
          aiCalls.push(args);
          const { choice = "text", probability = 0.95 } = options;
          if (choice instanceof Error) {
            return Promise.reject(choice);
          }
          const others = ["text", "quote", "palette"].filter(
            (option) => option !== choice
          );
          return Promise.resolve({
            answers: {
              type: {
                type: "choice",
                choice,
                confidence: probability,
                probabilities: {
                  [choice]: probability,
                  ...Object.fromEntries(
                    others.map((option) => [option, (1 - probability) / 2])
                  ),
                },
              },
            },
            usage: { input_tokens: 90, output_tokens: 0 },
          });
        },
      } as never,
      AI_USAGE: {
        writeDataPoint: (point: AnalyticsEngineDataPoint) => {
          points.push(point);
        },
      } as AnalyticsEngineDataset,
    });
    const job = testJob(
      env,
      testDeps(env, convex.fetcher, (spec) => callFilesOp(env, spec))
    );
    const result = await classifyCard(job);
    if (result.mode !== "completed") {
      throw new Error("expected a completed classification");
    }
    const recorded = convex
      .callsTo("workflows/steps/classificationMutations:recordClassification")
      .map((call) => call.args);
    return { aiCalls, points, recorded, result };
  };

  test("an unquoted quotation becomes a quote", async () => {
    const { aiCalls, points, recorded, result } = await review(
      { content: "Make it work, then make it fast. — my old teacher" },
      { choice: "quote", probability: 0.92 }
    );
    expect(result).toMatchObject({ confidence: 0.92, type: "quote" });
    expect(recorded).toEqual([
      expect.objectContaining({ confidence: 0.92, type: "quote" }),
    ]);
    expect(aiCalls).toHaveLength(1);
    expect(points.map((point) => point.indexes)).toEqual([[USER_ID]]);
    expect(points[0]?.blobs?.slice(1, 3)).toEqual([
      "@cf/cloudflare/clef-flash",
      "teak.ai.decision",
    ]);
    expect(points[0]?.doubles?.[2]).toBe(90);
  });

  test("vetoes the quote-mark heuristic", async () => {
    const { result } = await review(
      { content: '"Are you coming to dinner tonight?"' },
      { choice: "text", probability: 0.9 }
    );
    expect(result.type).toBe("text");
  });

  test("vetoes the palette rule for CSS", async () => {
    const { result } = await review(
      { content: ".button { color: #ffffff; background: #000000; }" },
      { choice: "text", probability: 0.95 }
    );
    expect(result.type).toBe("text");
  });

  test("a palette with no colours stays text", async () => {
    const { result } = await review(
      { content: "my favourite things" },
      { choice: "palette", probability: 0.95 }
    );
    expect(result.type).toBe("text");
  });

  test("an unsure answer keeps the rules", async () => {
    const { result } = await review(
      { content: "Make it work. — someone" },
      { choice: "quote", probability: 0.6 }
    );
    expect(result.type).toBe("text");
  });

  test("a failing model keeps the rules", async () => {
    const { result } = await review(
      { content: "#264653 #2a9d8f #e9c46a" },
      { choice: new Error("model exploded") }
    );
    expect(result.type).toBe("palette");
  });

  test("an explicitly saved quote is not reviewed", async () => {
    const { aiCalls, result } = await review(
      { content: "to be or not to be", type: "quote" },
      { choice: "text", probability: 0.99 }
    );
    expect(result.type).toBe("quote");
    expect(aiCalls).toEqual([]);
  });

  test("links are not reviewed", async () => {
    const { aiCalls } = await review(
      { content: "hi", url: "https://example.com" },
      { choice: "quote", probability: 0.99 }
    );
    expect(aiCalls).toEqual([]);
  });

  test.each(["user_disabled", "paused"])(
    "AI %s keeps the rules and calls no model",
    async (gate) => {
      const { aiCalls, result } = await review(
        { content: "Make it work. — someone" },
        { choice: "quote", gate, probability: 0.99 }
      );
      expect(result.type).toBe("text");
      expect(aiCalls).toEqual([]);
    }
  );
});
