// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";
import { generateTextMetadata, generateImageMetadata, generateLinkMetadata } from "./generators";

const mockGenerateObject = mock();
mock.module("ai", () => ({
  generateObject: mockGenerateObject,
}));

describe("aiMetadata generators", () => {
  const mockResponse = {
    object: {
      tags: ["tag1", "tag2"],
      summary: "A summary",
    },
  };

  test("generateTextMetadata calls generateObject with text model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    const result = await generateTextMetadata("some content", "My Title");
    
    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining("some content"),
    }));
    expect(result).toEqual({ aiTags: ["tag1", "tag2"], aiSummary: "A summary" });
  });

  test("generateImageMetadata calls generateObject with image model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    const result = await generateImageMetadata("https://img.com", "My Image");
    
    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([
            expect.objectContaining({
                content: expect.arrayContaining([
                    expect.objectContaining({ type: "image", image: "https://img.com" })
                ])
            })
        ])
    }));
    expect(result).toEqual({ aiTags: ["tag1", "tag2"], aiSummary: "A summary" });
  });

  test("generateLinkMetadata calls generateObject with link model", async () => {
    mockGenerateObject.mockResolvedValue(mockResponse);
    const result = await generateLinkMetadata("page content", "https://url.com");
    
    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining("page content"),
    }));
    expect(result).toEqual({ aiTags: ["tag1", "tag2"], aiSummary: "A summary" });
  });

  test("handles errors", async () => {
      mockGenerateObject.mockRejectedValue(new Error("AI error"));
      expect(generateTextMetadata("c")).rejects.toThrow("AI error");
      expect(generateImageMetadata("url")).rejects.toThrow("AI error");
      expect(generateLinkMetadata("c")).rejects.toThrow("AI error");
  });
});
