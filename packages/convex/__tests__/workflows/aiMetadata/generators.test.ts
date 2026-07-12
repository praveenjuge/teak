// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ ?? {};
aiMocks.generateText ??= mock();
aiMocks.generateObject ??= mock();
aiMocks.experimental_transcribe ??= mock();
aiMocks.Output ??= { object: mock() };
(global as any).__AI_MOCKS__ = aiMocks;
const mockGenerateText = aiMocks.generateText;

mock.module("ai", () => aiMocks);

let generateTextMetadata: any;
let generateImageMetadata: any;
let generateLinkMetadata: any;
let boundAiMetadataInput: any;
let maxInputChars: number;
let maxOutputTokens: number;
let maxRetries: number;
let maxValidationRetries: number;

const mockResponse = {
  output: {
    tags: ["tag1", "tag2"],
    summary: "A summary",
  },
  usage: { inputTokens: 10, outputTokens: 5 },
};

describe("aiMetadata generators", () => {
  beforeAll(async () => {
    const mod = await import("../../../workflows/aiMetadata/generators");
    generateTextMetadata = mod.generateTextMetadata;
    generateImageMetadata = mod.generateImageMetadata;
    generateLinkMetadata = mod.generateLinkMetadata;
    boundAiMetadataInput = mod.boundAiMetadataInput;
    maxInputChars = mod.MAX_AI_METADATA_INPUT_CHARS;
    maxOutputTokens = mod.MAX_AI_METADATA_OUTPUT_TOKENS;
    maxRetries = mod.MAX_AI_METADATA_RETRIES;
    maxValidationRetries = mod.MAX_AI_METADATA_VALIDATION_RETRIES;
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
        experimental_telemetry: expect.objectContaining({
          functionId: "teak.ai.metadata.text",
          recordInputs: false,
          recordOutputs: false,
        }),
        prompt: expect.stringContaining("some content"),
        maxRetries,
        maxOutputTokens,
        providerOptions: {
          groq: { reasoningEffort: "low", structuredOutputs: false },
        },
      })
    );
  });

  test("generateImageMetadata calls generateText with image model", async () => {
    mockGenerateText.mockResolvedValue(mockResponse);
    await generateImageMetadata("https://img.com", "My Image");

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        experimental_telemetry: expect.objectContaining({
          functionId: "teak.ai.metadata.image",
        }),
        messages: expect.arrayContaining([expect.any(Object)]),
        maxRetries,
        maxOutputTokens,
        providerOptions: { groq: { structuredOutputs: false } },
      })
    );
  });

  test("generateLinkMetadata calls generateText with link model", async () => {
    mockGenerateText.mockResolvedValue(mockResponse);
    await generateLinkMetadata("page content", "https://url.com");

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        experimental_telemetry: expect.objectContaining({
          functionId: "teak.ai.metadata.link",
        }),
        prompt: expect.stringContaining("page content"),
        maxRetries,
        maxOutputTokens,
        providerOptions: {
          groq: { reasoningEffort: "low", structuredOutputs: false },
        },
      })
    );
  });

  test("keeps short metadata input unchanged", () => {
    expect(maxRetries).toBe(5);
    expect(maxValidationRetries).toBe(2);
    expect(maxOutputTokens).toBe(768);
    expect(boundAiMetadataInput("short content")).toBe("short content");
  });

  test("bounds long metadata input while retaining both ends", () => {
    const content = `${"a".repeat(maxInputChars)}MIDDLE${"z".repeat(maxInputChars)}`;
    const bounded = boundAiMetadataInput(content);

    expect(bounded.length).toBe(maxInputChars);
    expect(bounded.startsWith("aaaa")).toBe(true);
    expect(bounded.endsWith("zzzz")).toBe(true);
    expect(bounded).toContain(
      `[Content truncated from ${content.length} characters]`
    );
    expect(bounded).not.toContain("MIDDLE");
  });

  test("bounds complete text, image, and link prompts", async () => {
    const oversized = "x".repeat(maxInputChars * 2);
    mockGenerateText.mockResolvedValue(mockResponse);

    await generateTextMetadata(oversized, oversized);
    const textCall = mockGenerateText.mock.calls.at(-1)?.[0];
    expect(textCall.prompt.length).toBe(maxInputChars);

    await generateImageMetadata("https://img.com", oversized);
    const imageCall = mockGenerateText.mock.calls.at(-1)?.[0];
    expect(imageCall.messages[0].content[0].text.length).toBe(maxInputChars);

    await generateLinkMetadata(oversized, `https://example.com/${oversized}`);
    const linkCall = mockGenerateText.mock.calls.at(-1)?.[0];
    expect(linkCall.prompt.length).toBe(maxInputChars);
  });

  test("handles errors in all generators", () => {
    mockGenerateText.mockRejectedValue(new Error("AI error"));
    expect(generateTextMetadata("c")).rejects.toThrow("AI error");
    expect(generateImageMetadata("url")).rejects.toThrow("AI error");
    expect(generateLinkMetadata("url")).rejects.toThrow("AI error");
  });

  test("retries provider JSON validation failures with a corrective prompt", async () => {
    mockGenerateText
      .mockRejectedValueOnce(
        new Error(
          "Failed to validate JSON. See failed_generation for more details."
        )
      )
      .mockResolvedValueOnce(mockResponse);

    await generateImageMetadata("https://img.com/example.jpeg");

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const retryCall = mockGenerateText.mock.calls[1]?.[0];
    expect(retryCall.messages[0].content[0].text).toStartWith(
      "JSON validation retry 1:"
    );
  });

  test("stops after the bounded JSON validation retry budget", async () => {
    mockGenerateText.mockRejectedValue(
      new Error("Failed to validate JSON. See failed_generation.")
    );

    await expect(
      generateImageMetadata("https://img.com/example.jpeg")
    ).rejects.toThrow("Failed to validate JSON");
    expect(mockGenerateText).toHaveBeenCalledTimes(maxValidationRetries + 1);
  });
});
