import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  FilesOnboardingCardResult,
  FilesStoreOnboardingFilesParams,
} from "@teak/files-protocol";
import { getFunctionName } from "convex/server";
import { ONBOARDING_CARDS } from "../../card/defaultCards";
import { addOnboardingCards } from "../../card/onboardingFiles";
import { buildR2UserPrefix } from "../../storage/r2";

const USER_ID = "teak_new";
const UPLOAD_CARDS = ONBOARDING_CARDS.filter((card) => card.uploads?.length);
const UPLOADS = UPLOAD_CARDS.flatMap((card) => card.uploads ?? []);
const ENV_KEYS = ["FILES_BASE", "FILES_SIGNING_SECRET"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

interface Stored {
  fileSize?: number;
  keys: Record<string, string>;
  onboarding: string;
}

let ops: { op: string; params: Record<string, unknown> }[];
let registered: string[][];
let inserts: { createdAt: number; stored: Stored[]; userId: string }[];
let failCard: string | undefined;
let workerStatus: number;
let registrationAllowed: boolean;
let failInsert: boolean;
let insertedCount: number;

const sizeOf = (key: string) => key.length * 100;

const storeOnboardingFiles = ({
  cards,
}: FilesStoreOnboardingFilesParams): FilesOnboardingCardResult[] =>
  cards.map((card) =>
    card.onboarding === failCard
      ? { onboarding: card.onboarding, stored: false, error: "missing" }
      : {
          onboarding: card.onboarding,
          stored: true,
          files: card.files.map((file) => ({
            key: file.key,
            size: sizeOf(file.key),
          })),
        }
  );

const filesWorkerFetch = mock(
  (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    ops.push({ op: request.op, params: request.params });
    if (request.op === "store-onboarding-files") {
      if (workerStatus !== 200) {
        return Promise.resolve(
          Response.json(
            {
              ok: false,
              error: { code: "INTERNAL", message: "x", requestId: "r" },
            },
            { status: workerStatus }
          )
        );
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          data: { cards: storeOnboardingFiles(request.params) },
        })
      );
    }
    return Promise.resolve(Response.json({ ok: true, data: {} }));
  }
);

const ctx = {
  runMutation: mock((ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (name.endsWith("registerObjects")) {
      registered.push(args.keys as string[]);
      return Promise.resolve(registrationAllowed);
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
  const action = addOnboardingCards as unknown as {
    _handler: (c: typeof ctx, a: unknown) => Promise<null>;
  };
  return action._handler(ctx, { userId: USER_ID, createdAt: 1000 });
};

const storeCall = () => {
  const call = ops.find((entry) => entry.op === "store-onboarding-files");
  return call?.params as unknown as FilesStoreOnboardingFilesParams | undefined;
};
const sentKeys = () =>
  storeCall()?.cards.flatMap((card) => card.files.map((file) => file.key)) ??
  [];
const deletedKeys = () =>
  ops
    .filter((entry) => entry.op === "delete-objects")
    .flatMap((entry) => entry.params.keys as string[]);

beforeEach(() => {
  process.env.FILES_BASE = "https://files.example.test";
  process.env.FILES_SIGNING_SECRET = "onboarding-test-secret";
  globalThis.fetch = filesWorkerFetch as unknown as typeof fetch;
  ops = [];
  registered = [];
  inserts = [];
  failCard = undefined;
  workerStatus = 200;
  registrationAllowed = true;
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
  test("the Files Worker stores every file in one call, then all the cards go in at once", async () => {
    await run();

    const call = storeCall();
    expect(call?.cards.map((card) => card.onboarding)).toEqual(
      UPLOAD_CARDS.map((card) => card.onboarding)
    );
    expect(
      call?.cards.flatMap((card) =>
        card.files.map(({ contentType, source }) => ({ contentType, source }))
      )
    ).toEqual(
      UPLOADS.map((upload) => ({
        contentType: upload.mimeType,
        source: upload.source,
      }))
    );
    for (const key of sentKeys()) {
      expect(key.startsWith(`${buildR2UserPrefix(USER_ID)}/stored/`)).toBe(
        true
      );
    }
    expect(registered).toEqual([sentKeys()]);

    expect(inserts).toHaveLength(1);
    const [insert] = inserts;
    expect(insert?.createdAt).toBe(1000);
    const stored = new Map(
      insert?.stored.map((entry) => [entry.onboarding, entry])
    );
    for (const card of UPLOAD_CARDS) {
      const sent = call?.cards.find((c) => c.onboarding === card.onboarding);
      const entry = stored.get(card.onboarding);
      for (const [index, upload] of (card.uploads ?? []).entries()) {
        expect(entry?.keys[upload.slot]).toBe(sent?.files[index]?.key);
      }
    }
    const memo = stored.get("audio");
    expect(memo?.fileSize).toBe(sizeOf(memo?.keys.file ?? ""));
    expect(deletedKeys()).toEqual([]);
  });

  test("keys name the file's slot and name, like an upload's", async () => {
    await run();

    const video = storeCall()?.cards.find((c) => c.onboarding === "video");
    expect(
      video?.files.map((file) => file.key.split("/").slice(-2, -1)[0])
    ).toEqual(["file", "thumbnail", "scrub"]);
    expect(video?.files[0]?.key).toMatch(/-Find-anything-in-Teak\.mp4$/);
  });

  test("a card the Worker could not store is left out", async () => {
    failCard = "video";

    await run();

    const onboarding = inserts[0]?.stored.map((entry) => entry.onboarding);
    expect(onboarding).not.toContain("video");
    expect(onboarding).toContain("audio");
  });

  test("when the Worker call fails, every key is deleted and the cards needing no files still arrive", async () => {
    workerStatus = 500;

    await run();

    expect(deletedKeys().sort()).toEqual(sentKeys().sort());
    expect(inserts).toEqual([{ createdAt: 1000, stored: [], userId: USER_ID }]);
  });

  test("an account that takes no writes stores nothing", async () => {
    registrationAllowed = false;

    await run();

    expect(storeCall()).toBeUndefined();
    expect(deletedKeys()).toEqual([]);
    expect(inserts).toEqual([{ createdAt: 1000, stored: [], userId: USER_ID }]);
  });

  test("when the cards can't be inserted, the files are deleted and the cards needing none still arrive", async () => {
    failInsert = true;

    await run();

    expect(deletedKeys().sort()).toEqual(sentKeys().sort());
    expect(inserts).toEqual([{ createdAt: 1000, stored: [], userId: USER_ID }]);
  });

  test("when the account already has the cards, the stored files are deleted", async () => {
    insertedCount = 0;

    await run();

    expect(inserts).toHaveLength(1);
    expect(deletedKeys().sort()).toEqual(sentKeys().sort());
  });
});
