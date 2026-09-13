// @ts-nocheck
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { ConvexError } from "convex/values";

let finalizeHandler: any;
let buildR2UserPrefix: any;

const originalFetch = globalThis.fetch;
const originalFilesBase = process.env.FILES_BASE;
const originalSigningSecret = process.env.FILES_SIGNING_SECRET;

const workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let workerResponder: (
  op: string,
  params: Record<string, unknown>
) => { status: number; envelope: Record<string, unknown> } = () => ({
  envelope: { data: {}, ok: true },
  status: 200,
});

const jsonResponse = (
  envelope: Record<string, unknown>,
  status: number
): Response =>
  new Response(JSON.stringify(envelope), {
    headers: { "content-type": "application/json" },
    status,
  });

beforeAll(async () => {
  const actionModule = await import("../../card/uploadCardAction");
  const finalizeAction = actionModule.finalizeUploadedCardForUser;
  finalizeHandler = finalizeAction.handler ?? finalizeAction;
  ({ buildR2UserPrefix } = await import("../../storage/r2"));
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  globalThis.fetch = ((_url: unknown, init: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    workerCalls.push({ op: body.op, params: body.params });
    const { envelope, status } = workerResponder(body.op, body.params);
    return Promise.resolve(jsonResponse(envelope, status));
  }) as typeof fetch;
});

afterEach(() => {
  workerCalls.length = 0;
  workerResponder = () => ({
    envelope: { data: {}, ok: true },
    status: 200,
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
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

const finalizeArgs = (overrides: Record<string, unknown> = {}) => ({
  cardType: "audio",
  fileKey: `${buildR2UserPrefix("user_1")}/pending/file/source-object`,
  fileName: "song.mp3",
  fileSize: 1024,
  fileType: "audio/mpeg",
  userId: "user_1",
  ...overrides,
});

const createCtx = () => {
  const mutationArgs: Record<string, unknown>[] = [];
  return {
    ctx: {
      runMutation: (_ref: unknown, args: Record<string, unknown>) => {
        if ("sourceKey" in args) {
          return Promise.resolve({ consumed: false });
        }
        mutationArgs.push(args);
        return Promise.resolve({ cardId: "card_1", status: "created" });
      },
    },
    mutationArgs,
  };
};

describe("finalizeUploadedCardForUser", () => {
  test("sends verification context and stores worker facts over client claims", async () => {
    workerResponder = (op) => {
      if (op === "finalize-upload") {
        return {
          envelope: {
            data: {
              facts: { duration: 180 },
              formatId: "mpeg-audio",
              mimeType: "audio/mpeg",
              processorVersion: "files/1",
              sourceEtag: '"source-etag"',
              storedEtag: '"stored-etag"',
              storedFileSize: 1024,
              storedMimeType: "audio/mpeg",
              verificationLevel: "structural",
            },
            ok: true,
          },
          status: 200,
        };
      }
      return { envelope: { data: {}, ok: true }, status: 200 };
    };
    const { ctx, mutationArgs } = createCtx();
    const result = await finalizeHandler(
      ctx,
      finalizeArgs({
        additionalMetadata: { duration: 5, width: 9999 },
      })
    );
    expect(result).toEqual({ cardId: "card_1", success: true });
    const finalizeCall = workerCalls.find(
      (call) => call.op === "finalize-upload"
    );
    expect(finalizeCall?.params).toMatchObject({
      fileName: "song.mp3",
      requestedMimeType: "audio/mpeg",
    });
    expect(mutationArgs).toHaveLength(1);
    // Worker duration wins on conflict; the client width survives because
    // the worker derived no width for this upload.
    expect(mutationArgs[0]?.additionalMetadata).toEqual({
      duration: 180,
      width: 9999,
    });
    expect(mutationArgs[0]?.mimeType).toBe("audio/mpeg");
    expect(mutationArgs[0]?.processing).toMatchObject({
      processorVersion: "files/1",
      sourceEtag: '"source-etag"',
      storedEtag: '"stored-etag"',
      verificationLevel: "structural",
    });
    expect(typeof mutationArgs[0]?.processing?.generatedAt).toBe("number");
  });

  test("maps worker verification failures to TYPE_MISMATCH", async () => {
    workerResponder = (op) => {
      if (op === "finalize-upload") {
        return {
          envelope: {
            error: {
              code: "INVALID_INPUT",
              message: "verification failed",
              requestId: "req-1",
            },
            ok: false,
          },
          status: 400,
        };
      }
      return { envelope: { data: {}, ok: true }, status: 200 };
    };
    const { ctx, mutationArgs } = createCtx();
    let error: unknown;
    try {
      await finalizeHandler(ctx, finalizeArgs());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data).toMatchObject({
      code: "TYPE_MISMATCH",
    });
    expect(mutationArgs).toHaveLength(0);
    expect(workerCalls.some((call) => call.op === "delete-object")).toBe(true);
  });

  test("rejects when the verified format no longer matches the request", async () => {
    workerResponder = (op) => {
      if (op === "finalize-upload") {
        return {
          envelope: {
            data: {
              facts: {},
              formatId: "wave-audio",
              mimeType: "audio/wav",
              storedFileSize: 1024,
              storedMimeType: "audio/wav",
              verificationLevel: "structural",
            },
            ok: true,
          },
          status: 200,
        };
      }
      return { envelope: { data: {}, ok: true }, status: 200 };
    };
    const { ctx, mutationArgs } = createCtx();
    let error: unknown;
    try {
      await finalizeHandler(ctx, finalizeArgs());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data).toMatchObject({
      code: "TYPE_MISMATCH",
    });
    expect(mutationArgs).toHaveLength(0);
  });

  test("stores the worker palette as card colors for image uploads", async () => {
    workerResponder = (op) => {
      if (op === "finalize-image-upload") {
        return {
          envelope: {
            data: {
              decodedFormat: "image/png",
              height: 64,
              palette: ["#112233", "#445566"],
              processorVersion: "files/1",
              sourceEtag: '"source-etag"',
              storedEtag: '"stored-etag"',
              storedFileSize: 2048,
              storedMimeType: "image/png",
              verificationLevel: "decode",
              width: 64,
            },
            ok: true,
          },
          status: 200,
        };
      }
      return { envelope: { data: {}, ok: true }, status: 200 };
    };
    const { ctx, mutationArgs } = createCtx();
    const result = await finalizeHandler(
      ctx,
      finalizeArgs({
        additionalMetadata: { height: 1, width: 1 },
        cardType: "image",
        fileName: "photo.png",
        fileSize: 2048,
        fileType: "image/png",
      })
    );
    expect(result).toEqual({ cardId: "card_1", success: true });
    expect(mutationArgs).toHaveLength(1);
    expect(mutationArgs[0]?.colors).toEqual([
      { hex: "#112233" },
      { hex: "#445566" },
    ]);
    expect(mutationArgs[0]?.additionalMetadata).toEqual({
      height: 64,
      width: 64,
    });
    expect(mutationArgs[0]?.processing).toMatchObject({
      processorVersion: "files/1",
      verificationLevel: "decode",
    });
  });
});
