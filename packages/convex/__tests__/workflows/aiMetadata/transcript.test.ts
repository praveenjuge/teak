import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { generateTranscript } from "../../../workflows/aiMetadata/transcript";

const originalFetch = globalThis.fetch;
const prior = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};
const mockFetch = mock(
  (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.reject(new Error("Unexpected fetch"))
);
beforeEach(() => {
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  process.env.R2_KEY_PREFIX = "";
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("generateTranscript", () => {
  test("requests transcription by source key without downloading audio", async () => {
    mockFetch.mockResolvedValue(
      Response.json({
        ok: true,
        version: 1,
        data: {
          text: "Transcript",
          byteLength: 8,
          mimeType: "audio/mp4",
          sourceEtag: '"1"',
        },
      })
    );
    expect(
      await generateTranscript("users/u/card/file/audio.m4a", "audio/mp4")
    ).toBe("Transcript");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, request] = mockFetch.mock.calls[0];
    expect(url).toBe("https://files.test/__ops/v1");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      op: "transcribe-audio",
      params: {
        sourceKey: "users/u/card/file/audio.m4a",
        mimeType: "audio/mp4",
      },
    });
    expect(new Headers(request?.headers).has("x-teak-signature")).toBe(true);
  });
  test("preserves optional enrichment failure semantics", async () => {
    for (const code of [
      "NOT_FOUND",
      "PAYLOAD_TOO_LARGE",
      "UNSUPPORTED",
      "INTERNAL",
    ]) {
      mockFetch.mockResolvedValue(
        Response.json(
          { ok: false, error: { code, requestId: "test" } },
          { status: 500 }
        )
      );
      expect(await generateTranscript("users/u/file")).toBeNull();
    }
    mockFetch.mockRejectedValue(new Error("offline"));
    expect(await generateTranscript("users/u/file")).toBeNull();
  });
  test("rejects arbitrary URLs and keys outside this deployment before fetching", async () => {
    expect(await generateTranscript("https://attacker.test/audio")).toBeNull();
    process.env.R2_KEY_PREFIX = "dev/";
    expect(await generateTranscript("users/u/file")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
