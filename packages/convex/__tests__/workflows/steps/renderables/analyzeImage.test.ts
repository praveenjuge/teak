// @ts-nocheck
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";

let analyzeImage: any;

const originalFetch = globalThis.fetch;
const originalFilesBase = process.env.FILES_BASE;
const originalSigningSecret = process.env.FILES_SIGNING_SECRET;

beforeAll(async () => {
  const stepModule = await import(
    "../../../../workflows/steps/renderables/analyzeImage"
  );
  const step = stepModule.analyzeImage;
  analyzeImage = step.handler ?? step;
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  globalThis.fetch = (() =>
    Promise.reject(new Error("worker must not be called"))) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("worker must not be called"))) as typeof fetch;
  if (originalFilesBase === undefined) {
    delete process.env.FILES_BASE;
  } else {
    process.env.FILES_BASE = originalFilesBase;
  }
  if (originalSigningSecret === undefined) {
    delete process.env.FILES_SIGNING_SECRET;
  } else {
    process.env.FILES_SIGNING_SECRET = originalSigningSecret;
  }
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const createCtx = (card: unknown) => {
  const mutationCalls: Array<{ ref: unknown; args: unknown }> = [];
  return {
    ctx: {
      runMutation: (ref: unknown, args: unknown) => {
        mutationCalls.push({ args, ref });
        return Promise.resolve(null);
      },
      runQuery: () => Promise.resolve(card),
    },
    mutationCalls,
  };
};

describe("analyzeImage trusted-facts skip", () => {
  test("skips re-analysis when dimensions and colors are already trusted", async () => {
    process.env.FILES_BASE = "https://files.test";
    process.env.FILES_SIGNING_SECRET = "test-secret";
    const { ctx, mutationCalls } = createCtx({
      colors: [{ hex: "#112233" }],
      fileKey: "users/u/cards/c/file/photo",
      fileMetadata: { height: 64, width: 64 },
      type: "image",
    });
    const result = await analyzeImage(ctx, { cardId: "card_1" });
    expect(result).toEqual({ generated: false, success: true });
    expect(mutationCalls).toHaveLength(0);
  });

  test("still analyzes when colors are missing", async () => {
    delete process.env.FILES_BASE;
    delete process.env.FILES_SIGNING_SECRET;
    const { ctx, mutationCalls } = createCtx({
      fileKey: "users/u/cards/c/file/photo",
      fileMetadata: { height: 64, width: 64 },
      type: "image",
    });
    const result = await analyzeImage(ctx, { cardId: "card_1" });
    expect(result).toEqual({
      error: "files_worker_not_configured",
      generated: false,
      success: false,
    });
    expect(mutationCalls).toHaveLength(0);
  });
});
