import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "../lib";
import { type FilesOpsEnv, handleInternalOp } from "../ops";
import { FakeBucket } from "../test/testsupport";

const SECRET = "test-secret";
const ASSETS_DIR = join(import.meta.dir, "../../assets");
const PREFIX = "users/1l7d0vx/cards/stored";

// The assets server answers by path alone, like env.ASSETS.
const assetsFromDisk = (): Fetcher =>
  ({
    fetch: async (input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input));
      try {
        return new Response(await readFile(join(ASSETS_DIR, pathname)));
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },
  }) as unknown as Fetcher;

const sendOp = async (
  bucket: FakeBucket,
  params: unknown,
  assets: Fetcher | undefined = assetsFromDisk()
) => {
  const body = JSON.stringify({
    op: "store-onboarding-files",
    params,
    version: FILES_PROTOCOL_VERSION,
  });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
      headers: {
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": await hmacSha256Hex(
          SECRET,
          buildFilesOpSigningPayload({
            bodySha256: await sha256Hex(body),
            expiresAt,
            requestId,
          })
        ),
      },
      method: "POST",
    }),
    {
      ASSETS: assets,
      BUCKET: bucket as never,
      FILES_SIGNING_SECRET: SECRET,
    } as FilesOpsEnv
  );
  return {
    body: (await response.json()) as {
      data?: { cards: Record<string, unknown>[] };
      error?: { code: string };
    },
    status: response.status,
  };
};

const VIDEO = {
  onboarding: "video",
  files: [
    {
      contentType: "video/mp4",
      key: `${PREFIX}/file/a-Find-anything-in-Teak.mp4`,
      source: "find-anything-in-teak.mp4",
    },
    {
      contentType: "image/jpeg",
      key: `${PREFIX}/thumbnail/b-thumbnail.jpg`,
      source: "tour-thumbnail.jpg",
    },
  ],
};
const AUDIO = {
  onboarding: "audio",
  files: [
    {
      contentType: "audio/mp4",
      key: `${PREFIX}/file/c-Brand-refresh-voice-memo.m4a`,
      source: "brand-refresh-voice-memo.m4a",
    },
  ],
};

const onDisk = (source: string) =>
  readFile(join(ASSETS_DIR, "onboarding", source));

describe("the store-onboarding-files op", () => {
  test("copies each shipped file to its key, with its type, and reports its size", async () => {
    const bucket = new FakeBucket();

    const { body, status } = await sendOp(bucket, { cards: [VIDEO, AUDIO] });

    expect(status).toBe(200);
    for (const file of [...VIDEO.files, ...AUDIO.files]) {
      const original = await onDisk(file.source);
      expect(bucket.storedBytes(file.key)).toEqual(new Uint8Array(original));
      expect(bucket.objects.get(file.key)?.httpMetadata).toEqual({
        contentType: file.contentType,
      });
    }
    const memo = (await onDisk("brand-refresh-voice-memo.m4a")).byteLength;
    expect(body.data?.cards).toEqual([
      {
        onboarding: "video",
        stored: true,
        files: [
          {
            key: VIDEO.files[0]!.key,
            size: (await onDisk("find-anything-in-teak.mp4")).byteLength,
          },
          {
            key: VIDEO.files[1]!.key,
            size: (await onDisk("tour-thumbnail.jpg")).byteLength,
          },
        ],
      },
      {
        onboarding: "audio",
        stored: true,
        files: [{ key: AUDIO.files[0]!.key, size: memo }],
      },
    ]);
  });

  test("a card with a missing file keeps none of its files; the others still land", async () => {
    const bucket = new FakeBucket();
    const broken = {
      ...VIDEO,
      files: [
        VIDEO.files[0]!,
        { ...VIDEO.files[1]!, source: "no-such-file.jpg" },
      ],
    };

    const { body, status } = await sendOp(bucket, { cards: [broken, AUDIO] });

    expect(status).toBe(200);
    expect(body.data?.cards[0]).toEqual({
      onboarding: "video",
      stored: false,
      error: "onboarding_file_missing:no-such-file.jpg",
    });
    expect(body.data?.cards[1]).toMatchObject({
      onboarding: "audio",
      stored: true,
    });
    expect([...bucket.objects.keys()]).toEqual([AUDIO.files[0]!.key]);
  });

  test.each([
    ["a source outside the folder", { source: "../README.md" }],
    ["a nested source", { source: "onboarding/coral-lily.webp" }],
    ["a key outside the user roots", { key: "secrets/coral-lily.webp" }],
    ["no content type", { contentType: "" }],
  ])("refuses %s and writes nothing", async (_name, change) => {
    const bucket = new FakeBucket();
    const file = { ...AUDIO.files[0]!, ...change };

    const { body, status } = await sendOp(bucket, {
      cards: [{ onboarding: "audio", files: [file] }],
    });

    expect(status).toBe(400);
    expect(body.error?.code).toBe("INVALID_INPUT");
    expect(bucket.puts).toEqual([]);
  });

  test("refuses the same key twice", async () => {
    const bucket = new FakeBucket();

    const { status } = await sendOp(bucket, {
      cards: [AUDIO, { ...AUDIO, onboarding: "again" }],
    });

    expect(status).toBe(400);
    expect(bucket.puts).toEqual([]);
  });

  test("without the assets binding the call fails and can be retried", async () => {
    const bucket = new FakeBucket();

    const { body, status } = await sendOp(
      bucket,
      { cards: [AUDIO] },
      null as never
    );

    expect(status).toBe(500);
    expect(body.error?.code).toBe("INTERNAL");
    expect(bucket.puts).toEqual([]);
  });
});
