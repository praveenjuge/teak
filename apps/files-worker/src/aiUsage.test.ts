import { describe, expect, test } from "bun:test";
import { meteredAiRun, runWithAiUsage } from "./aiUsage";
import { generateTextMetadataForOp } from "./textMetadata";

const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const OWNER = {
  cardId: "card_1",
  convexSiteUrl: "https://test-deployment.convex.site",
  userId: "teak_owner",
};

const dataset = () => {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    AI_USAGE: {
      writeDataPoint: (point?: AnalyticsEngineDataPoint) => {
        if (point) {
          points.push(point);
        }
      },
    } as AnalyticsEngineDataset,
    points,
  };
};

describe("AI usage data points", () => {
  test("charge each call to the card's owner with its tokens and cost", async () => {
    const { AI_USAGE, points } = dataset();
    const result = await runWithAiUsage(OWNER, () =>
      meteredAiRun(
        { AI_USAGE },
        { functionId: "teak.ai.metadata.image", model: GEMMA },
        async () => ({
          response: "{}",
          usage: { completion_tokens: 500, prompt_tokens: 2000 },
        })
      )
    );
    expect(result).toMatchObject({ response: "{}" });
    expect(points).toHaveLength(1);
    const [point] = points;
    expect(point?.indexes).toEqual(["teak_owner"]);
    expect(point?.blobs).toEqual([
      OWNER.convexSiteUrl,
      GEMMA,
      "teak.ai.metadata.image",
      "ok",
    ]);
    const [calls, errors, input, output, cost] = point?.doubles ?? [];
    expect([calls, errors, input, output]).toEqual([1, 0, 2000, 500]);
    // 2000 × $0.10 + 500 × $0.30 per million tokens.
    expect(cost).toBeCloseTo(0.000_35, 10);
  });

  test("record a failed call as an error and rethrow it", async () => {
    const { AI_USAGE, points } = dataset();
    const failure = Object.assign(new Error("capacity"), { status: 429 });
    await expect(
      runWithAiUsage(OWNER, () =>
        meteredAiRun(
          { AI_USAGE },
          {
            functionId: "teak.ai.embedding",
            isCapacity: () => true,
            model: "@cf/embedding",
          },
          () => Promise.reject(failure)
        )
      )
    ).rejects.toBe(failure);
    expect(points[0]?.blobs?.[3]).toBe("capacity");
    expect(points[0]?.doubles?.slice(0, 2)).toEqual([1, 1]);
  });

  test("charge no one for calls outside a card's context", async () => {
    const { AI_USAGE, points } = dataset();
    await meteredAiRun(
      { AI_USAGE },
      { functionId: "teak.ai.embedding", model: "@cf/embedding" },
      async () => ({ data: [] })
    );
    expect(points).toEqual([]);
  });

  test("count every validation retry of a metadata op as its own call", async () => {
    const { AI_USAGE, points } = dataset();
    const replies = [
      {
        response: "not json",
        usage: { completion_tokens: 5, prompt_tokens: 10 },
      },
      {
        response: JSON.stringify({ summary: "A note.", tags: ["note"] }),
        usage: { completion_tokens: 7, prompt_tokens: 12 },
      },
    ];
    await runWithAiUsage(OWNER, () =>
      generateTextMetadataForOp(
        {
          AI: { run: async () => replies.shift() },
          AI_USAGE,
        } as never,
        "generate-link-metadata",
        { prompt: "Title: A note" }
      )
    );
    expect(points.map((point) => point.blobs?.[2])).toEqual([
      "teak.ai.metadata.link",
      "teak.ai.metadata.link",
    ]);
    expect(points.map((point) => point.doubles?.slice(2, 4))).toEqual([
      [10, 5],
      [12, 7],
    ]);
  });
});
