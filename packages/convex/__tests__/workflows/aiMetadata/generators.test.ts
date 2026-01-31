// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ || {
  generateText: mock(),
  generateObject: mock(),
  experimental_transcribe: mock(),
  Output: { object: mock() },
};
(global as any).__AI_MOCKS__ = aiMocks;
const mockGenerateText = aiMocks.generateText;

mock.module("ai", () => aiMocks);

let generateTextMetadata: any;
let generateImageMetadata: any;
let generateLinkMetadata: any;

const mockResponse = {
  output: {
    tags: ["tag1", "tag2"],
    summary: "A summary",
  },
};

describe("aiMetadata generators", () => {
  beforeAll(async () => {
    const mod = await import("../../../workflows/aiMetadata/generators");
    generateTextMetadata = mod.generateTextMetadata;
    generateImageMetadata = mod.generateImageMetadata;
    generateLinkMetadata = mod.generateLinkMetadata;
  });

  beforeEach(() => {
    mockGenerateText.mockReset();
    aiMocks.Output.object.mockReset();
    aiMocks.Output.object.mockReturnValue({ schema: {} });
  });

  test("generateTextMetadata calls generateText with text model", async () => {
    mockGenerateText.mockResolvedValue(mockResponse);
    await generateTextMetadata("some content", "My Title");

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("some content"),
      })
    );
  });

  test("generateImageMetadata calls generateText with image model", async () => {
    mockGenerateText.mockResolvedValue(mockResponse);
    await generateImageMetadata("https://img.com", "My Image");

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  test("generateLinkMetadata calls generateText with link model", async () => {
    mockGenerateText.mockResolvedValue(mockResponse);
    await generateLinkMetadata("page content", "https://url.com");

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("page content"),
      })
    );
  });

  test("handles errors in all generators", async () => {
    mockGenerateText.mockRejectedValue(new Error("AI error"));
    expect(generateTextMetadata("c")).rejects.toThrow("AI error");
    expect(generateImageMetadata("url")).rejects.toThrow("AI error");
    expect(generateLinkMetadata("url")).rejects.toThrow("AI error");
  });
});
