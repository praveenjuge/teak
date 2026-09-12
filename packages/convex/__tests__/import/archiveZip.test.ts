import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  readImportIndexPage,
  readLegacyMarkdown,
} from "../../import/archiveZip";

const originalFetch = globalThis.fetch;
const prior = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};
const fetchMock = mock(
  (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.reject(new Error("Unexpected fetch"))
);
beforeEach(() => {
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  process.env.R2_KEY_PREFIX = "";
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
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
describe("import worker client", () => {
  test("sends a signed source-version-bound page request", async () => {
    const page = {
      items: [{ sourceIndex: 100, card: { type: "text", content: "Hello" } }],
      total: 101,
      nextCursor: null,
      sourceEtag: '"a"',
    };
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: page }));
    expect(
      await readImportIndexPage({
        sourceKey: "users/u/imports/j/source",
        expectedSize: 20,
        mode: "archive",
        cursor: 100,
        sourceEtag: '"a"',
      })
    ).toEqual(page);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://files.test/__ops/v1");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      op: "index-import-source",
      params: { sourceEtag: '"a"', cursor: 100 },
    });
  });
  test("preserves per-item Markdown failures from the worker", async () => {
    const failure = {
      status: "failed",
      failureCode: "INVALID_UTF8",
      failureReason: "Invalid UTF-8",
    };
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: failure }));
    expect(
      await readLegacyMarkdown(
        "users/u/imports/j/source",
        '"a"',
        "files/note.md"
      )
    ).toEqual(failure);
  });
  test("does not silently fall back to S3 or accept a different namespace", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { ok: false, error: { code: "NOT_FOUND" } },
        { status: 404 }
      )
    );
    await expect(
      readImportIndexPage({
        sourceKey: "users/u/imports/j/source",
        mode: "archive",
        expectedSize: 20,
      })
    ).rejects.toThrow("import_source_unavailable");
    fetchMock.mockClear();
    await expect(
      readLegacyMarkdown("elsewhere/source", '"a"', "files/note.md")
    ).rejects.toThrow("invalid_storage_key_namespace");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
