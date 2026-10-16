import { describe, expect, test } from "bun:test";
import {
  DECISION_THRESHOLDS,
  MAX_DECISION_QUESTIONS,
} from "@teak/files-protocol";
import { runWithAiUsage } from "./aiUsage";
import {
  decideCardType,
  decideLinkCategory,
  decideVisualStylesForImage,
  LINK_CATEGORY_DESCRIPTIONS,
  scoreRelevance,
} from "./decisions";
import type { FilesOpsEnv } from "./ops";

interface Call {
  args: Record<string, unknown>;
  model: string;
}

const fakeEnv = (
  reply: (args: Record<string, unknown>) => unknown,
  calls: Call[] = []
): FilesOpsEnv =>
  ({
    AI: {
      run: (model: string, args: Record<string, unknown>) => {
        calls.push({ args, model });
        const result = reply(args);
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      },
    },
  }) as unknown as FilesOpsEnv;

const firstArgs = (calls: Call[]): Record<string, unknown> => {
  const call = calls[0];
  if (!call) {
    throw new Error("expected a Workers AI call");
  }
  return call.args;
};

const choiceReply =
  (id: string, choice: string, probability: number) =>
  (args: Record<string, unknown>) => {
    const criteria = (
      args.questions as Record<string, { criteria: Record<string, unknown> }>
    )[id]?.criteria as Record<string, unknown>;
    const options = Object.keys(criteria);
    const rest = (1 - probability) / (options.length - 1);
    return {
      answers: {
        [id]: {
          type: "choice",
          choice,
          confidence: probability,
          probabilities: Object.fromEntries(
            options.map((option) => [
              option,
              option === choice ? probability : rest,
            ])
          ),
        },
      },
      model: "clef",
      usage: { input_tokens: 120, output_tokens: 0 },
    };
  };

const linkParams = {
  url: "https://example.com/dish",
  title: "Weeknight lentil soup",
  description: "Ingredients and steps for a quick soup.",
  jsonLdTypes: ["Recipe", "Recipe", "WebPage"],
  rulesCategory: "other",
};

describe("link category", () => {
  test("a confident new category replaces the rules' answer", async () => {
    const calls: Call[] = [];
    const result = await decideLinkCategory(
      fakeEnv(choiceReply("category", "recipe", 0.97), calls),
      linkParams
    );
    expect(result.decision).toEqual({ category: "recipe", confidence: 0.97 });
    expect(result.model).toBe("@cf/cloudflare/clef");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 0 });
    expect(calls[0]?.model).toBe("@cf/cloudflare/clef");
    expect(firstArgs(calls).model).toBe("clef");
    expect(
      (firstArgs(calls).state as { structuredDataTypes: string[] })
        .structuredDataTypes
    ).toEqual(["Recipe", "WebPage"]);
  });

  test("other is listed first, so a tie falls to it", async () => {
    const calls: Call[] = [];
    await decideLinkCategory(
      fakeEnv(choiceReply("category", "recipe", 0.93), calls),
      linkParams
    );
    const criteria = (
      firstArgs(calls).questions as Record<
        string,
        { criteria: Record<string, string> }
      >
    ).category?.criteria;
    expect(Object.keys(criteria ?? {})[0]).toBe("other");
    expect(Object.keys(criteria ?? {})).toEqual(
      Object.keys(LINK_CATEGORY_DESCRIPTIONS)
    );
  });

  test.each([
    ["below the threshold", "recipe", DECISION_THRESHOLDS.linkCategory - 0.01],
    ["the rules' own answer", "other", 0.99],
  ])("keeps the rules for %s", async (_name, choice, probability) => {
    const result = await decideLinkCategory(
      fakeEnv(choiceReply("category", choice, probability)),
      linkParams
    );
    expect(result.decision).toBeNull();
  });

  test("never moves a guessed category to other", async () => {
    const result = await decideLinkCategory(
      fakeEnv(choiceReply("category", "other", 0.99)),
      { ...linkParams, rulesCategory: "article" }
    );
    expect(result.decision).toBeNull();
  });

  test("an answer outside the criteria fails the call", async () => {
    await expect(
      decideLinkCategory(
        fakeEnv(() => ({
          answers: {
            category: {
              type: "choice",
              choice: "cookbook",
              confidence: 0.9,
              probabilities: { cookbook: 0.9 },
            },
          },
        })),
        linkParams
      )
    ).rejects.toThrow("invalid_clef_answer");
  });

  test.each([
    ["a missing url", { ...linkParams, url: "" }, "invalid_url"],
    ["a non-url", { ...linkParams, url: "not a url" }, "invalid_url"],
    [
      "an unknown rules category",
      { ...linkParams, rulesCategory: "cookbook" },
      "invalid_rules_category",
    ],
  ])("rejects %s", async (_name, params, message) => {
    await expect(
      decideLinkCategory(
        fakeEnv(() => ({})),
        params
      )
    ).rejects.toThrow(message);
  });
});

describe("card type", () => {
  test("an unquoted quotation becomes a quote", async () => {
    const result = await decideCardType(
      fakeEnv(choiceReply("type", "quote", 0.92)),
      {
        content: "Make it work, then make it fast. — my old teacher",
        rulesType: "text",
      }
    );
    expect(result.decision).toEqual({ type: "quote", confidence: 0.92 });
    expect(result.model).toBe("@cf/cloudflare/clef-flash");
  });

  test("can veto the palette rule", async () => {
    const result = await decideCardType(
      fakeEnv(choiceReply("type", "text", 0.95)),
      { content: ".a { color: #fff; background: #000 }", rulesType: "palette" }
    );
    expect(result.decision).toEqual({ type: "text", confidence: 0.95 });
  });

  test("text is the first option", async () => {
    const calls: Call[] = [];
    await decideCardType(fakeEnv(choiceReply("type", "text", 0.95), calls), {
      content: "hello",
      rulesType: "text",
    });
    const criteria = (
      firstArgs(calls).questions as Record<
        string,
        { criteria: Record<string, string> }
      >
    ).type?.criteria;
    expect(Object.keys(criteria ?? {})).toEqual(["text", "quote", "palette"]);
  });

  test("truncates long notes", async () => {
    const calls: Call[] = [];
    await decideCardType(fakeEnv(choiceReply("type", "text", 0.95), calls), {
      content: "x".repeat(50_000),
      rulesType: "text",
    });
    expect((firstArgs(calls).state as string).length).toBe(4000);
  });

  test("keeps the rules when unsure", async () => {
    const result = await decideCardType(
      fakeEnv(choiceReply("type", "quote", 0.6)),
      { content: "Hello there", rulesType: "text" }
    );
    expect(result.decision).toBeNull();
  });
});

describe("visual styles", () => {
  const image = {
    bytes: new Uint8Array([1, 2, 3]),
    dataUrl: "data:image/jpeg;base64,AQID",
  };

  test("keeps confident styles, most likely first, at most four", async () => {
    const probabilities: Record<string, number> = {
      "style.minimal": 0.95,
      "style.flat": 0.91,
      "style.geometric": 0.88,
      "style.pastel": 0.8,
      "style.typographic": 0.75,
      "style.dark": 0.2,
    };
    const calls: Call[] = [];
    const result = await decideVisualStylesForImage(
      fakeEnv(
        (args) => ({
          answers: Object.fromEntries(
            Object.keys(args.questions as object).map((id) => [
              id,
              { type: "noul", noul: probabilities[id] ?? 0.1 },
            ])
          ),
        }),
        calls
      ),
      image
    );
    expect(result.styles).toEqual(["minimal", "flat", "geometric", "pastel"]);
    expect(Object.keys(firstArgs(calls).questions as object)).toHaveLength(19);
    expect(firstArgs(calls).images).toEqual([image.dataUrl]);
  });

  test("an image Clef would reject is no decision, so tags decide", async () => {
    const calls: Call[] = [];
    await expect(
      decideVisualStylesForImage(
        fakeEnv(() => ({}), calls),
        {
          bytes: new Uint8Array(4 * 1024 * 1024 + 1),
          dataUrl: "data:",
        }
      )
    ).rejects.toThrow("clef_image_too_large");
    expect(calls).toHaveLength(0);
  });
});

describe("relevance", () => {
  const cards = [
    { id: "card_a", text: "Lentil soup recipe" },
    { id: "card_b", text: "Car insurance renewal" },
  ];

  test("scores every card, keyed back to its id", async () => {
    const calls: Call[] = [];
    const result = await scoreRelevance(
      fakeEnv(
        () => ({
          answers: {
            "card.0": {
              type: "score",
              score: 2.8,
              confidence: 0.9,
              legend: {},
              probabilities: { "3": 0.8, "2": 0.2 },
            },
            "card.1": {
              type: "score",
              score: 0.1,
              confidence: 0.9,
              legend: {},
              probabilities: { "0": 0.9, "1": 0.1 },
            },
          },
        }),
        calls
      ),
      { query: "soup", cards }
    );
    expect(result.scores).toEqual([
      { id: "card_a", score: 2.8 },
      { id: "card_b", score: 0.1 },
    ]);
    expect(firstArgs(calls).state).toEqual({ search: "soup" });
  });

  test.each([
    ["no cards", { query: "soup", cards: [] }],
    [
      "too many cards",
      {
        query: "soup",
        cards: Array.from({ length: MAX_DECISION_QUESTIONS + 1 }, (_, i) => ({
          id: `c${i}`,
          text: "x",
        })),
      },
    ],
    ["duplicate ids", { query: "soup", cards: [cards[0], cards[0]] }],
    ["an empty query", { query: " ", cards }],
  ])("rejects %s", async (_name, params) => {
    await expect(
      scoreRelevance(
        fakeEnv(() => ({})),
        params
      )
    ).rejects.toThrow(/invalid_/u);
  });

  test("a score past the rubric fails the call", async () => {
    await expect(
      scoreRelevance(
        fakeEnv(() => ({
          answers: {
            "card.0": {
              type: "score",
              score: 7,
              confidence: 0.9,
              legend: {},
              probabilities: {},
            },
            "card.1": {
              type: "score",
              score: 1,
              confidence: 0.9,
              legend: {},
              probabilities: {},
            },
          },
        })),
        { query: "soup", cards }
      )
    ).rejects.toThrow("invalid_clef_answer");
  });
});

test("capacity errors retry, then report AI capacity", async () => {
  const calls: Call[] = [];
  await expect(
    decideCardType(
      fakeEnv(
        () => Object.assign(new Error("Capacity"), { code: 3040 }),
        calls
      ),
      { content: "hi", rulesType: "text" }
    )
  ).rejects.toThrow("workers_ai_capacity_exhausted");
  expect(calls).toHaveLength(3);
});

test("each Clef call is charged to the card's owner in AI usage", async () => {
  const points: AnalyticsEngineDataPoint[] = [];
  const env = {
    ...fakeEnv(choiceReply("type", "quote", 0.9)),
    AI_USAGE: {
      writeDataPoint: (point?: AnalyticsEngineDataPoint) => {
        if (point) {
          points.push(point);
        }
      },
    } as AnalyticsEngineDataset,
  } as FilesOpsEnv;
  await runWithAiUsage(
    {
      convexSiteUrl: "https://test-deployment.convex.site",
      userId: "teak_owner",
    },
    () => decideCardType(env, { content: "hi", rulesType: "text" })
  );
  expect(points).toHaveLength(1);
  expect(points[0]?.indexes).toEqual(["teak_owner"]);
  expect(points[0]?.blobs?.slice(1)).toEqual([
    "@cf/cloudflare/clef-flash",
    "teak.ai.decision",
    "ok",
  ]);
  const [calls, errors, input, output, cost] = points[0]?.doubles ?? [];
  expect([calls, errors, input, output]).toEqual([1, 0, 120, 0]);
  // 120 input tokens at Clef-flash's $0.038 per million; no output price.
  expect(cost).toBeCloseTo(0.000_004_56, 12);
});
