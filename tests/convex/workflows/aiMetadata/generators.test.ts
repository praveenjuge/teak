// @ts-nocheck
import { mock, describe, expect, test, beforeEach, beforeAll } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ || {
  generateObject: mock(),
  experimental_transcribe: mock(),
};
(global as any).__AI_MOCKS__ = aiMocks;
const mockGenerateObject = aiMocks.generateObject;

mock.module("ai", () => aiMocks);

let generateTextMetadata: any;
let generateImageMetadata: any;
let generateLinkMetadata: any;

const mockResponse = {
  object: {
    aiTags: ["tag1", "tag2"],
    aiSummary: "A summary",
  },
};

describe("aiMetadata generators", () => {
  beforeAll(async () => {
    const mod = await import("../../../../convex/workflows/aiMetadata/generators");
    generateTextMetadata = mod.generateTextMetadata;
    generateImageMetadata = mod.generateImageMetadata;
    generateLinkMetadata = mod.generateLinkMetadata;
  });

  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  test("generateTextMetadata calls generateObject with text model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    await generateTextMetadata("some content", "My Title");

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("some content"),
    }));
  });

  test("generateImageMetadata calls generateObject with image model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    await generateImageMetadata("https://img.com", "My Image");

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([expect.any(Object)]),
    }));
  });

  test("generateLinkMetadata calls generateObject with link model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    await generateLinkMetadata("page content", "https://url.com");

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("page content"),
    }));
  });

  test("handles errors in all generators", async () => {
    mockGenerateObject.mockRejectedValue(new Error("AI error"));
    expect(generateTextMetadata("c")).rejects.toThrow("AI error");
    expect(generateImageMetadata("url")).rejects.toThrow("AI error");
    expect(generateLinkMetadata("url")).rejects.toThrow("AI error");
  });
});
