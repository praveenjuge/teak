import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { inferFileFormat } from "../../shared/fileFormats";
import { extractFileTextForAiForKey } from "../../workflows/fileProcessing";
import { asFetch } from "../helpers/convex.test-utils";

const originalFetch = globalThis.fetch;
const prior = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
};
const mockFetch = mock(
  (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.reject(new Error("Unexpected fetch"))
);
beforeEach(() => {
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
  globalThis.fetch = asFetch(mockFetch);
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

const PDF_KEY = "users/u/cards/c/file/report.pdf";
const pdfFormat = () => {
  const format = inferFileFormat({
    fileName: "report.pdf",
    mimeType: "application/pdf",
  });
  if (!format) {
    throw new Error("pdf format missing");
  }
  return format;
};
const pdfCard = { fileMetadata: { kind: "pdf" } };

describe("extractFileTextForAiForKey for PDFs", () => {
  test("asks the files worker for PDF text and returns it", async () => {
    mockFetch.mockResolvedValue(
      Response.json({
        data: { facts: { pageCount: 2 }, text: "Annual report\nNet income" },
        ok: true,
        requestId: "r1",
        version: 1,
      })
    );

    expect(
      await extractFileTextForAiForKey(PDF_KEY, pdfFormat(), pdfCard)
    ).toBe("Annual report\nNet income");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, request] = mockFetch.mock.calls[0];
    expect(url).toBe("https://files.test/__ops/v1");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      op: "inspect",
      params: {
        formatId: "pdf",
        // Any upload size: the renderer reads PDFs up to Teak's 100 MiB cap.
        maxBytes: 100 * 1024 * 1024,
        mode: "pdf",
        sourceKey: PDF_KEY,
      },
    });
  });

  test("returns no text when the deployed worker predates the pdf mode", async () => {
    mockFetch.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "invalid_inspect_params",
            requestId: "r2",
            retryable: false,
          },
          ok: false,
          version: 1,
        },
        { status: 400 }
      )
    );

    expect(
      await extractFileTextForAiForKey(PDF_KEY, pdfFormat(), pdfCard)
    ).toBe("");
  });

  test.each([
    ["INTERNAL", 500],
    ["RENDERER_UNAVAILABLE", 503],
  ])(
    "still surfaces %s so workflow retries apply",
    async (code: string, status: number) => {
      mockFetch.mockResolvedValue(
        Response.json(
          {
            error: {
              code,
              message: "Unavailable",
              requestId: "r3",
              retryable: true,
            },
            ok: false,
            version: 1,
          },
          { status }
        )
      );

      await expect(
        extractFileTextForAiForKey(PDF_KEY, pdfFormat(), pdfCard)
      ).rejects.toThrow(`files_worker_error:${code}:${status}`);
    }
  );
});
