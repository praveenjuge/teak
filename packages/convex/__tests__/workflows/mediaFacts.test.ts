// @ts-nocheck
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { extractFileTextForAiForKey } from "../../workflows/fileProcessing";
import { recordMediaFacts } from "../../workflows/mediaFacts";

const NAMES = ["FILES_BASE", "FILES_SIGNING_SECRET"] as const;
const previous = NAMES.map((name) => process.env[name]);
const originalFetch = global.fetch;
let ops: Array<{ op: string; params: Record<string, unknown> }> = [];

const answer = (envelope: unknown, status = 200) => {
  global.fetch = (_url, init) => {
    ops.push(JSON.parse(String(init?.body)));
    return Promise.resolve(Response.json(envelope, { status }));
  };
};
const ok = (data: unknown) => ({ ok: true, version: 1, requestId: "r", data });

beforeEach(() => {
  ops = [];
  process.env.FILES_BASE = "https://files.teakvault.com";
  process.env.FILES_SIGNING_SECRET = "test-secret";
});

afterEach(() => {
  global.fetch = originalFetch;
  NAMES.forEach((name, index) => {
    if (previous[index] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous[index];
    }
  });
});

const recordingCtx = () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    ctx: {
      runMutation: (ref, args) => {
        calls.push({ name: getFunctionName(ref), args });
        return Promise.resolve(null);
      },
    },
  };
};

describe("recordMediaFacts", () => {
  test("stores a video's probed duration and display size", async () => {
    answer(
      ok({
        container: "mov",
        durationSeconds: 3.0004,
        hasAudio: false,
        hasVideo: true,
        height: 64,
        videoCodec: "avc1",
        width: 36,
      })
    );
    const { calls, ctx } = recordingCtx();

    await recordMediaFacts(
      ctx,
      { _id: "c1", fileKey: "users/u/cards/c1/file/a.mov", fileMetadata: {} },
      "video"
    );

    expect(ops).toEqual([
      {
        op: "probe-media",
        params: { sourceKey: "users/u/cards/c1/file/a.mov" },
        version: 1,
      },
    ]);
    expect(calls).toEqual([
      {
        name: "workflows/steps/renderables/mutations:updateCardMediaFacts",
        args: { cardId: "c1", duration: 3, height: 64, width: 36 },
      },
    ]);
  });

  test("stores only the duration for audio", async () => {
    answer(ok({ durationSeconds: 61.25, height: 10, width: 10 }));
    const { calls, ctx } = recordingCtx();

    await recordMediaFacts(
      ctx,
      { _id: "c2", fileKey: "users/u/cards/c2/file/a.m4a" },
      "audio"
    );

    expect(calls.map((call) => call.args)).toEqual([
      { cardId: "c2", duration: 61.25 },
    ]);
  });

  test("skips the probe when the card already has every fact", async () => {
    answer(ok({}));
    const { calls, ctx } = recordingCtx();

    await recordMediaFacts(
      ctx,
      {
        _id: "c3",
        fileKey: "users/u/cards/c3/file/a.mp4",
        fileMetadata: { duration: 4, height: 2, width: 2 },
      },
      "video"
    );

    expect(ops).toEqual([]);
    expect(calls).toEqual([]);
  });

  test.each([
    [
      "an older Worker without the operation",
      {
        ok: false,
        version: 1,
        error: {
          code: "UNSUPPORTED",
          message: "Unsupported operation",
          requestId: "r",
          retryable: false,
        },
      },
      400,
    ],
    [
      "an unknown container",
      {
        ok: false,
        version: 1,
        error: {
          code: "UNSUPPORTED",
          message: "media_probe_unsupported",
          requestId: "r",
          retryable: false,
        },
      },
      415,
    ],
    ["a malformed answer", ok({ durationSeconds: "12", width: -1 }), 200],
  ])("leaves the card unchanged for %s", async (_name, envelope, status) => {
    answer(envelope, status);
    const { calls, ctx } = recordingCtx();

    await recordMediaFacts(
      ctx,
      { _id: "c4", fileKey: "users/u/cards/c4/file/a.webm" },
      "video"
    );

    expect(calls).toEqual([]);
  });
});

describe("extractFileTextForAiForKey for PDFs", () => {
  const pdf = { id: "pdf", kind: "pdf" };

  test("returns the Worker's PDF text layer", async () => {
    answer(ok({ facts: { pageCount: 2 }, text: "Quarterly plan" }));

    expect(
      await extractFileTextForAiForKey("users/u/cards/c/file/a.pdf", pdf, {})
    ).toBe("Quarterly plan");
    expect(ops[0]).toMatchObject({
      op: "inspect",
      params: { formatId: "pdf", mode: "pdf" },
    });
  });

  test("treats a Worker that rejects the pdf mode as no text, so metadata still runs", async () => {
    answer(
      {
        ok: false,
        version: 1,
        error: {
          code: "INVALID_INPUT",
          message: "invalid_inspect_params",
          requestId: "r",
          retryable: false,
        },
      },
      400
    );

    expect(
      await extractFileTextForAiForKey("users/u/cards/c/file/a.pdf", pdf, {})
    ).toBe("");
  });
});
