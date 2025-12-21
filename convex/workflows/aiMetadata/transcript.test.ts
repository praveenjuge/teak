// @ts-nocheck
import { mock, describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ || {
    generateObject: mock(),
    experimental_transcribe: mock(),
};
(global as any).__AI_MOCKS__ = aiMocks;
const mockTranscribe = aiMocks.experimental_transcribe;

mock.module("ai", () => aiMocks);

const originalFetch = global.fetch;
const mockFetch = mock();

let generateTranscript: any;

describe("generateTranscript", () => {
    beforeAll(async () => {
        global.fetch = mockFetch;
        generateTranscript = (await import("./transcript")).generateTranscript;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        mockTranscribe.mockReset();
        mockFetch.mockReset();
    });

    test("generates transcript successfully", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            headers: { get: () => "audio/mp3" },
            arrayBuffer: async () => new ArrayBuffer(8),
        });
        mockTranscribe.mockResolvedValue({ text: "Transcript text" });

        const result = await generateTranscript("https://audio.com/file.mp3");
        expect(result).toBe("Transcript text");
    });

    test("handles fetch error", async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
        const result = await generateTranscript("url");
        expect(result).toBeNull();
    });

    test("handles transcription error", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            headers: { get: () => "audio/mp3" },
            arrayBuffer: async () => new ArrayBuffer(8),
        });
        mockTranscribe.mockRejectedValue(new Error("AI error"));
        const result = await generateTranscript("url");
        expect(result).toBeNull();
    });

    test("mime type extension logic > covers all branches", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            headers: { get: () => "audio/wav" },
            arrayBuffer: async () => new ArrayBuffer(8),
        });
        mockTranscribe.mockResolvedValue({ text: "Wav" });
        await generateTranscript("u");
        expect(mockTranscribe).toHaveBeenCalled();
    });

    test("mime type extension logic > uses mimeHint", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            headers: { get: () => "audio/unknown" },
            arrayBuffer: async () => new ArrayBuffer(8),
        });
        mockTranscribe.mockResolvedValue({ text: "Mime" });
        await generateTranscript("u", "audio/mp4");
        expect(mockTranscribe).toHaveBeenCalled();
    });
});
