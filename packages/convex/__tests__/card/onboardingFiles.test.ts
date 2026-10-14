import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ONBOARDING_CARDS } from "../../card/defaultCards";
import { addOnboardingCards } from "../../card/onboardingFiles";
import { buildR2UserPrefix } from "../../storage/r2";

const USER_ID = "teak_new";
const UPLOADS = ONBOARDING_CARDS.flatMap((card) => card.uploads ?? []);
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
interface Stored {
  fileSize?: number;
  keys: Record<string, string>;
  onboarding: string;
}

let inserts: { createdAt: number; stored: Stored[]; userId: string }[];
let failUploadOf: string | undefined;
/** Fails the insert that carries stored files; the fallback still lands. */
let failInsert: boolean;
/** What the insert reports, e.g. 0 when the account already has the cards. */
let insertedCount: number;

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
    if (name.endsWith("insertOnboardingCards")) {
      const insert = args as (typeof inserts)[number];
      if (failInsert && insert.stored.length > 0) {
        return Promise.reject(new Error("insert failed"));
      }
      inserts.push(insert);
      return Promise.resolve(insertedCount);
    }
    return Promise.reject(new Error(`unexpected mutation ${name}`));
  }),
};

const run = () => {
  const registered = addOnboardingCards as unknown as {
    _handler: (c: typeof ctx, a: unknown) => Promise<null>;
  };
  return registered._handler(ctx, { userId: USER_ID, createdAt: 1000 });
};

beforeEach(() => {
  process.env.FILES_BASE = "https://files.example.test";
  process.env.FILES_SIGNING_SECRET = "onboarding-test-secret";
  globalThis.fetch = filesWorkerFetch as unknown as typeof fetch;
  uploads = [];
  deletedKeys = [];
  inserts = [];
  failUploadOf = undefined;
  failInsert = false;
  insertedCount = 8;
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

describe("addOnboardingCards", () => {
  test("stores every file in the account, then inserts all the cards at once", async () => {
    await run();

    expect(uploads.map((upload) => upload.contentType).sort()).toEqual(
      UPLOADS.map((upload) => upload.mimeType).sort()
    );
    for (const upload of uploads) {
      expect(upload.key.startsWith(`${buildR2UserPrefix(USER_ID)}/`)).toBe(
        true
      );
    }
    expect(inserts).toHaveLength(1);
    const [insert] = inserts;
    expect(insert?.createdAt).toBe(1000);
    const stored = new Map(
      insert?.stored.map((entry) => [entry.onboarding, entry])
    );
    for (const card of ONBOARDING_CARDS.filter((def) => def.uploads)) {
      const entry = stored.get(card.onboarding);
      for (const upload of card.uploads ?? []) {
        expect(uploads.some((u) => u.key === entry?.keys[upload.slot])).toBe(
          true
        );
      }
    }
    // The original's size lands on the card.
    const memo = uploads.find((upload) => upload.contentType === "audio/mp4");
    expect(stored.get("audio")?.fileSize).toBe(memo?.bytes);
  });

  test("a card whose file fails to store is left out, and its other files deleted", async () => {
    failUploadOf = "scrub";

    await run();

    const onboarding = inserts[0]?.stored.map((entry) => entry.onboarding);
    expect(onboarding).not.toContain("video");
    expect(onboarding).toContain("audio");
    // The video's original and poster were stored before its scrub failed.
    const videoKeys = uploads
      .filter(
        (upload) =>
          upload.contentType === "video/mp4" ||
          (upload.contentType === "image/jpeg" &&
            upload.key.includes("/thumbnail/"))
      )
      .map((upload) => upload.key);
    expect(videoKeys.length).toBeGreaterThan(0);
    expect(deletedKeys.sort()).toEqual(videoKeys.sort());
  });

  test("when the cards can't be inserted, the files are deleted and the cards needing none still arrive", async () => {
    failInsert = true;

    await run();

    expect(deletedKeys.sort()).toEqual(uploads.map((u) => u.key).sort());
    expect(inserts).toEqual([{ createdAt: 1000, stored: [], userId: USER_ID }]);
  });

  test("when the account already has the cards, the stored files are deleted", async () => {
    insertedCount = 0;

    await run();

    expect(inserts).toHaveLength(1);
    expect(deletedKeys.sort()).toEqual(uploads.map((u) => u.key).sort());
  });
});
