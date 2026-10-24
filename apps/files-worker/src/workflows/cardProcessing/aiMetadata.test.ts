import { describe, expect, test } from "bun:test";
import { MAX_AI_METADATA_INPUT_CHARS } from "@teak/files-protocol";
import {
  createCardConvex,
  createFakeOps,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
} from "../../test/cardProcessingKit";
import { createWorkflowTelemetry } from "../telemetry";
import {
  generateLinkMetadata,
  generateTextMetadata,
  isAiMetadataDeferredError,
  isAiProviderCapacityError,
  normalizeAiTags,
  sanitizeTranscript,
} from "./aiMetadata";

const setup = (answer: OpAnswer) => {
  const fakes = createFakeOps({
    "generate-link-metadata": answer,
    "generate-text-metadata": answer,
  });
  const env = testEnv({ POSTHOG_PROJECT_TOKEN: "phc_test" });
  const convex = createCardConvex(makeCard());
  const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
  const events: Record<string, unknown>[] = [];
  const telemetry = createWorkflowTelemetry(env, {
    fetch: ((_url: RequestInfo | URL, init?: RequestInit) => {
      for (const event of JSON.parse(String(init?.body)).batch) {
        events.push({ event: event.event, ...event.properties });
      }
      return Promise.resolve(Response.json({ status: 1 }));
    }) as typeof fetch,
  });
  return { events, fakes, job, telemetry };
};

describe("AI metadata generation", () => {
  test("sends bounded prompts and records each call without its text", async () => {
    const { events, fakes, job, telemetry } = setup({
      data: {
        summary: "Useful.",
        tags: ["Design", "design"],
        usage: { inputTokens: 18, outputTokens: 7 },
        validationRetryCount: 1,
      },
    });
    const oversized = "x".repeat(MAX_AI_METADATA_INPUT_CHARS * 2);

    expect(
      await generateTextMetadata(job, telemetry, oversized, "Title")
    ).toEqual({
      aiSummary: "Useful.",
      aiTags: ["design"],
    });
    expect(
      await generateLinkMetadata(
        job,
        telemetry,
        oversized,
        "https://example.com"
      )
    ).toEqual({ aiSummary: "Useful.", aiTags: ["design"] });
    await telemetry.flush();

    expect(
      fakes.calls.map((call) => (call.params.prompt as string).length)
    ).toEqual([MAX_AI_METADATA_INPUT_CHARS, MAX_AI_METADATA_INPUT_CHARS]);
    expect(events).toMatchObject([
      {
        $ai_input_tokens: 18,
        $ai_is_error: false,
        $ai_output_tokens: 7,
        $ai_provider: "cloudflare",
        $ai_span_name: "teak.ai.metadata.text",
        $ai_total_cost_usd: expect.any(Number),
        $ai_trace_id: job.cardId,
        event: "$ai_generation",
      },
      { $ai_span_name: "teak.ai.metadata.link" },
    ]);
    expect(JSON.stringify(events)).not.toContain("Useful.");
    expect(JSON.stringify(events)).not.toContain("xxxx");
  });

  test.each([
    ["ko", "ko"],
    ["zh-CN", "zh"],
    ["jp", undefined],
    [undefined, undefined],
  ])(
    "the op's language %p arrives as aiLanguage %p",
    async (language, expected) => {
      const { job, telemetry } = setup({
        data: {
          summary: "디자인 노트.",
          tags: ["디자인"],
          validationRetryCount: 0,
          ...(language === undefined ? {} : { language }),
        },
      });
      expect(await generateTextMetadata(job, telemetry, "디자인")).toEqual({
        aiSummary: "디자인 노트.",
        aiTags: ["디자인"],
        ...(expected ? { aiLanguage: expected } : {}),
      });
    }
  );

  test.each([
    {
      answer: {
        throws: Object.assign(
          new Error("files_worker_ai: rate limit reached 429"),
          { aiFacts: { usage: { inputTokens: 24, outputTokens: 6 } } }
        ),
      },
      capacity: true,
      name: "Workers AI capacity",
      tokens: true,
    },
    {
      answer: {
        throws: Object.assign(
          new Error("files_worker_ai: failed to validate JSON"),
          { aiFacts: { usage: { inputTokens: 24, outputTokens: 6 } } }
        ),
      },
      capacity: false,
      name: "output that never validated",
      tokens: true,
    },
    {
      answer: { data: { summary: "Invalid", tags: [42] } },
      capacity: false,
      name: "a malformed success",
      tokens: false,
    },
    {
      answer: { fallback: "UNSUPPORTED" as const },
      capacity: false,
      name: "an op that declines",
      tokens: false,
    },
  ])("defers $name, recorded as an error", async (row) => {
    const { events, job, telemetry } = setup(row.answer as OpAnswer);
    let failure: unknown;
    try {
      await generateTextMetadata(job, telemetry, "Text");
    } catch (error) {
      failure = error;
    }
    await telemetry.flush();
    expect(events).toMatchObject([{ $ai_is_error: true }]);
    if (row.tokens) {
      expect(events[0]).toMatchObject({
        $ai_input_tokens: 24,
        $ai_output_tokens: 6,
      });
    } else {
      expect(events[0]?.$ai_input_tokens).toBeUndefined();
    }
    expect(isAiMetadataDeferredError(failure)).toBe(true);
    expect(isAiProviderCapacityError(failure)).toBe(row.capacity);
  });

  test("tells provider capacity from validation failures", () => {
    expect(
      isAiProviderCapacityError(
        new Error("Rate limit reached on tokens per day (TPD), status code 429")
      )
    ).toBe(true);
    expect(
      isAiProviderCapacityError(
        new Error("No object generated: response did not match schema")
      )
    ).toBe(false);
    expect(isAiMetadataDeferredError(new Error("No output generated."))).toBe(
      true
    );
    expect(isAiMetadataDeferredError(new Error("socket hang up"))).toBe(false);
  });
});

describe("normalizeAiTags", () => {
  test("trims, lowercases and de-duplicates in the model's order", () => {
    expect(normalizeAiTags(["Sky", " sky ", "", "Blue", "SKY"])).toEqual([
      "sky",
      "blue",
    ]);
  });

  test("keeps CJK, accented and Hangul tags as they are", () => {
    expect(
      normalizeAiTags([
        "デザイン",
        " 设计 ",
        "디자인",
        "Diseño",
        "DISEÑO",
        "Ölçü",
      ])
    ).toEqual(["デザイン", "设计", "디자인", "diseño", "ölçü"]);
  });

  test("keeps a translated secret as a normal tag; only secret and hidden hide", () => {
    expect(normalizeAiTags(["秘密", "secreto", "Secret"])).toEqual([
      "秘密",
      "secreto",
    ]);
  });

  test("drops the reserved tags that would hide a card", () => {
    expect(
      normalizeAiTags(["SECRET", " secret", "Hidden ", "beach", "secrets"])
    ).toEqual(["beach", "secrets"]);
  });
});

describe("sanitizeTranscript", () => {
  test.each([
    ["", undefined, null],
    ["...", undefined, null],
    ["Thank you.", 5, null],
    ["Thanks for watching! Bye.", undefined, null],
    ["Thank you.", 600, "Thank you."],
    ["Welcome to the show.", 5, "Welcome to the show."],
  ])("%p over %p seconds becomes %p", (text, durationSeconds, expected) => {
    expect(sanitizeTranscript(text, { durationSeconds })).toBe(expected);
  });
});
