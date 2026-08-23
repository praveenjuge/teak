// @ts-nocheck
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

const originalFetch = global.fetch;
const mockFetch = mock();

let generateTranscript: any;

const audioResponse = (mimeType = "audio/mp3") => ({
  ok: true,
  headers: { get: () => mimeType },
  arrayBuffer: async () => new ArrayBuffer(8),
});

const workersAiResponse = (text: string) => ({
  ok: true,
  json: async () => ({ result: { text }, success: true }),
});

describe("generateTranscript", () => {
  beforeAll(async () => {
    global.fetch = mockFetch;
    generateTranscript = (
      await import("../../../workflows/aiMetadata/transcript")
    ).generateTranscript;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  test("generates transcript successfully", async () => {
    mockFetch
      .mockResolvedValueOnce(audioResponse())
      .mockResolvedValueOnce(workersAiResponse("Transcript text"));

    const result = await generateTranscript("https://audio.com/file.mp3");
    expect(result).toBe("Transcript text");

    const request = mockFetch.mock.calls[1]?.[0];
    expect(request).toContain("/ai/run/@cf/openai/whisper-large-v3-turbo");
    expect(mockFetch.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(mockFetch.mock.calls[1]?.[1]?.headers["Content-Type"]).toBe(
      "audio/mp3"
    );
  });

  test("handles fetch error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    const result = await generateTranscript("url");
    expect(result).toBeNull();
  });

  test("handles transcription error response", async () => {
    mockFetch.mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        errors: [{ message: "Invalid input" }],
        success: false,
      }),
    });
    const result = await generateTranscript("url");
    expect(result).toBeNull();
  });

  test("handles network error during transcription", async () => {
    mockFetch
      .mockResolvedValueOnce(audioResponse())
      .mockRejectedValueOnce(new Error("AI error"));
    const result = await generateTranscript("url");
    expect(result).toBeNull();
  });

  test("mime type extension logic > covers all branches", async () => {
    mockFetch
      .mockResolvedValueOnce(audioResponse("audio/wav"))
      .mockResolvedValueOnce(workersAiResponse("Wav"));
    await generateTranscript("u");
    expect(mockFetch.mock.calls[1]?.[1]?.headers["Content-Type"]).toBe(
      "audio/wav"
    );
  });

  test("mime type extension logic > uses mimeHint", async () => {
    mockFetch
      .mockResolvedValueOnce(audioResponse("audio/unknown"))
      .mockResolvedValueOnce(workersAiResponse("Mime"));
    await generateTranscript("u", "audio/mp4");
    expect(mockFetch.mock.calls[1]?.[1]?.headers["Content-Type"]).toBe(
      "audio/mp4"
    );
  });
});
