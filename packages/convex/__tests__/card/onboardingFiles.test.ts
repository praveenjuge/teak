import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ONBOARDING_CARDS } from "../../card/defaultCards";
import { addOnboardingFileCards } from "../../card/onboardingFiles";
import { buildR2UserPrefix } from "../../storage/r2";

const USER_ID = "teak_new";
const FILE_CARDS = ONBOARDING_CARDS.filter((card) => card.file);
const ENV_KEYS = ["FILES_BASE", "FILES_SIGNING_SECRET"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

interface Upload {
  bytes: number;
  contentType: string | null;
  key: string;
}

let uploads: Upload[];
let deletedKeys: string[];
let inserted: Record<string, unknown>[];
let failUploadOf: string | undefined;
let failInsertOf: string | undefined;

// The Files Worker is the boundary: PUTs store bytes, op POSTs delete them.
const filesWorkerFetch = mock(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (init?.method === "PUT") {
      const key = decodeURIComponent(url.pathname).replace(
        /^\/(?:__upload\/v1\/)?/,
        ""
      );
      if (failUploadOf && key.includes(failUploadOf)) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false }), { status: 500 })
        );
      }
      const body = init.body as Blob;
      uploads.push({
        bytes: body.size,
        contentType: new Headers(init.headers).get("content-type"),
        key,
      });
      return Promise.resolve(
        Response.json({
          ok: true,
          data: { etag: "etag", key, size: body.size },
        })
      );
    }
    const request = JSON.parse(String(init?.body ?? "{}"));
    if (request.op === "delete-object") {
      deletedKeys.push(request.params.key);
    }
    return Promise.resolve(Response.json({ ok: true, data: {} }));
  }
);

const ctx = {
  runMutation: mock((ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (name.endsWith("registerObject")) {
      return Promise.resolve(true);
    }
    if (name.endsWith("insertOnboardingFileCard")) {
      if (args.onboarding === failInsertOf) {
        return Promise.reject(new Error("insert failed"));
      }
      inserted.push(args);
      return Promise.resolve("card_id");
    }
    return Promise.reject(new Error(`unexpected mutation ${name}`));
  }),
};

const run = (cards = FILE_CARDS) => {
  const registered = addOnboardingFileCards as unknown as {
    _handler: (c: typeof ctx, a: unknown) => Promise<null>;
  };
  return registered._handler(ctx, {
    userId: USER_ID,
    cards: cards.map((card, index) => ({
      onboarding: card.onboarding,
      createdAt: 1000 - index,
    })),
  });
};

beforeEach(() => {
  process.env.FILES_BASE = "https://files.example.test";
  process.env.FILES_SIGNING_SECRET = "onboarding-test-secret";
  globalThis.fetch = filesWorkerFetch as unknown as typeof fetch;
  uploads = [];
  deletedKeys = [];
  inserted = [];
  failUploadOf = undefined;
  failInsertOf = undefined;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("addOnboardingFileCards", () => {
  test("stores each getting-started file in the account, then adds its card", async () => {
    await run();

    expect(uploads.map((upload) => upload.contentType)).toEqual(
      FILE_CARDS.map((card) => card.file?.mimeType ?? "")
    );
    for (const upload of uploads) {
      expect(upload.key.startsWith(`${buildR2UserPrefix(USER_ID)}/`)).toBe(
        true
      );
      expect(upload.bytes).toBeGreaterThan(1000);
    }
    expect(
      inserted.map(({ onboarding, createdAt, fileKey }) => ({
        onboarding,
        createdAt,
        stored: uploads.some((upload) => upload.key === fileKey),
      }))
    ).toEqual(
      FILE_CARDS.map((card, index) => ({
        onboarding: card.onboarding,
        createdAt: 1000 - index,
        stored: true,
      }))
    );
  });

  test("a file that fails to upload is skipped and the rest still arrive", async () => {
    failUploadOf = "voice-memo";

    await run();

    expect(inserted.map((args) => args.onboarding)).toEqual(
      FILE_CARDS.map((card) => card.onboarding).filter((key) => key !== "audio")
    );
  });

  test("a card that can't be added has its stored file deleted", async () => {
    failInsertOf = "document";

    await run();

    const pdfUpload = uploads.find(
      (upload) => upload.contentType === "application/pdf"
    );
    expect(deletedKeys).toEqual([pdfUpload?.key ?? ""]);
    expect(inserted.map((args) => args.onboarding)).not.toContain("document");
  });
});
