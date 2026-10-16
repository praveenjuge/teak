import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

let workerCalls: Array<{
  op: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}> = [];
let workerAnswer: () => Promise<unknown>;
let aiGate = "allowed";
let reviewLinkCategoryWithClef: any;
let jsonLdTypesFrom: any;

beforeAll(async () => {
  mock.module(
    import.meta.resolve("../../../../storage/filesWorkerClient"),
    () => ({
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        return workerAnswer();
      },
      isFilesWorkerConfigured: () => true,
    })
  );
  ({ jsonLdTypesFrom, reviewLinkCategoryWithClef } = await import(
    "../../../../workflows/steps/categorization/clef"
  ));
});

beforeEach(() => {
  workerCalls = [];
  usageRecords = [];
  aiGate = "allowed";
});

let usageRecords: unknown[] = [];
const ctx = {
  runQuery: () => Promise.resolve(aiGate),
  runMutation: (_ref: unknown, args: unknown) => {
    usageRecords.push(args);
    return Promise.resolve(null);
  },
};

const card = {
  _id: "c1",
  type: "link",
  userId: "teak_user",
  metadata: {
    linkPreview: {
      status: "success",
      title: "Weeknight lentil soup",
      description: "Ingredients and steps.",
      siteName: "Example Kitchen",
    },
  },
};

const decided =
  (category: string | null, confidence = 0.93) =>
  () =>
    Promise.resolve({
      kind: "ok",
      data: {
        model: "@cf/cloudflare/clef",
        version: 1,
        usage: { inputTokens: 100, outputTokens: 0 },
        decision: category ? { category, confidence } : null,
      },
    });

const fallback = { category: "other", confidence: 0.35, reason: "fallback" };

describe("reviewLinkCategoryWithClef", () => {
  test("takes Clef's category for a fallback guess", async () => {
    workerAnswer = decided("recipe");
    const result = await reviewLinkCategoryWithClef(
      ctx,
      card,
      fallback,
      "https://example.com/soup",
      [{ "@type": "Recipe" }]
    );
    expect(result).toEqual({
      category: "recipe",
      confidence: 0.93,
      reason: "clef",
    });
    expect(usageRecords).toEqual([
      expect.objectContaining({
        userId: "teak_user",
        calls: 1,
        inputTokens: 100,
        costUsd: 0.000_024,
      }),
    ]);
    expect(workerCalls).toEqual([
      {
        op: "decide-link-category",
        params: {
          url: "https://example.com/soup",
          rulesCategory: "other",
          title: "Weeknight lentil soup",
          description: "Ingredients and steps.",
          siteName: "Example Kitchen",
          jsonLdTypes: ["Recipe"],
        },
        timeoutMs: 3000,
      },
    ]);
  });

  test.each(["domain_rule", "path_rule"])(
    "never asks Clef about a %s",
    async (reason) => {
      workerAnswer = decided("recipe");
      const rules = { category: "article", confidence: 0.8, reason };
      expect(
        await reviewLinkCategoryWithClef(ctx, card, rules, "https://a.b/c", [])
      ).toBe(rules);
      expect(workerCalls).toEqual([]);
    }
  );

  test("keeps the rules when Clef has no decision", async () => {
    workerAnswer = decided(null);
    expect(
      await reviewLinkCategoryWithClef(ctx, card, fallback, "https://a.b", [])
    ).toBe(fallback);
  });

  test("keeps the rules when the worker fails", async () => {
    workerAnswer = () =>
      Promise.reject(new Error("files_worker_network_error"));
    expect(
      await reviewLinkCategoryWithClef(ctx, card, fallback, "https://a.b", [])
    ).toBe(fallback);
  });

  test("keeps the rules for a reply naming an unknown category", async () => {
    workerAnswer = decided("cookbook");
    expect(
      await reviewLinkCategoryWithClef(ctx, card, fallback, "https://a.b", [])
    ).toBe(fallback);
  });

  test.each(["user_disabled", "paused"])(
    "skips Clef when AI is %s",
    async (gate) => {
      aiGate = gate;
      workerAnswer = decided("recipe");
      expect(
        await reviewLinkCategoryWithClef(ctx, card, fallback, "https://a.b", [])
      ).toBe(fallback);
      expect(workerCalls).toEqual([]);
    }
  );

  test("keeps a provider's category when Clef's would drop its facts", async () => {
    workerAnswer = decided("article");
    const amazon = {
      category: "product",
      confidence: 0.72,
      providerHint: "amazon",
      reason: "provider_mapping",
    };
    expect(
      await reviewLinkCategoryWithClef(ctx, card, amazon, "https://a.b", [])
    ).toBe(amazon);
  });

  test("allows a provider category its handler also enriches", async () => {
    workerAnswer = decided("book");
    const amazon = {
      category: "product",
      confidence: 0.72,
      providerHint: "amazon",
      reason: "provider_mapping",
    };
    expect(
      (await reviewLinkCategoryWithClef(ctx, card, amazon, "https://a.b", []))
        .category
    ).toBe("book");
  });
});

test("JSON-LD types come from entities, graphs and arrays, once each", () => {
  expect(
    jsonLdTypesFrom(
      [
        { "@type": ["Recipe", "HowTo"] },
        { "@graph": [{ "@type": "WebPage" }, { "@type": "Recipe" }] },
      ],
      { "@type": "Organization" }
    )
  ).toEqual(["Recipe", "HowTo", "WebPage", "Organization"]);
});
