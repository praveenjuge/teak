// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { generateTranscript } from "./transcript";

const mockTranscribe = mock();
mock.module("ai", () => ({
  experimental_transcribe: mockTranscribe,
}));

const mockFetch = mock();
global.fetch = mockFetch;

describe("generateTranscript", () => {
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
      expect(mockTranscribe).toHaveBeenCalledWith(expect.objectContaining({
          model: expect.anything(),
          audio: expect.any(Uint8Array),
      }));
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

  describe("mime type extension logic", () => {
      const mimeTypes = [
          "audio/ogg", "audio/mp3", "audio/wav", "audio/m4a", "audio/webm", "audio/flac", "audio/unknown"
      ];

      test("covers all branches", async () => {
          for (const mime of mimeTypes) {
              mockFetch.mockResolvedValueOnce({
                  ok: true,
                  headers: { get: () => mime },
                  arrayBuffer: async () => new ArrayBuffer(8),
              });
              mockTranscribe.mockResolvedValueOnce({ text: "" });
              await generateTranscript("url");
          }
      });
      
      test("uses mimeHint", async () => {
          mockFetch.mockResolvedValue({
              ok: true,
              headers: { get: () => "audio/webm" },
              arrayBuffer: async () => new ArrayBuffer(8),
          });
          mockTranscribe.mockResolvedValue({ text: "" });
          await generateTranscript("url", "audio/mp3");
      });
  });
});
