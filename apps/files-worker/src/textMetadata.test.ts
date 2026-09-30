import { describe, expect, mock, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  FILES_PROTOCOL_VERSION,
  TEXT_METADATA_MODEL_ID,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { FakeBucket } from "./testsupport";

const result = { tags: ["design", "systems"], summary: "A useful resource." };
const signedRequest = async (op: string, params: unknown) => {
  const body = JSON.stringify({ version: FILES_PROTOCOL_VERSION, op, params });
  const expiresAt = String(Math.floor(Date.now() / 1000) + 60);
  return new Request("https://files.teakvault.com/__ops/v1", {
    method: "POST",
    body,
    headers: {
      "x-teak-request-id": "metadata-test",
      "x-teak-expires-at": expiresAt,
      "x-teak-signature": await hmacSha256Hex(
        "test-secret",
        buildFilesOpSigningPayload({
          bodySha256: await sha256Hex(body),
          expiresAt,
          requestId: "metadata-test",
        })
      ),
    },
  });
};
const env = (
  run: (model: string, args: Record<string, unknown>) => Promise<unknown>
): FilesOpsEnv => ({
  BUCKET: new FakeBucket() as never,
  FILES_SIGNING_SECRET: "test-secret",
  AI: { run },
});

describe("signed text/link metadata", () => {
  test.each(["generate-text-metadata", "generate-link-metadata"])(
    "%s runs Qwen and returns only validated metadata",
    async (op) => {
      const run = mock((model: string, args: Record<string, unknown>) => {
        expect(model).toBe(TEXT_METADATA_MODEL_ID);
        expect(args.max_tokens).toBe(768);
        expect(JSON.stringify(args.messages)).toContain("/no_think");
        return Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...result, private: "ignored" }),
              },
            },
          ],
        });
      });
      const response = await handleInternalOp(
        await signedRequest(op, { prompt: "Analyze a useful resource" }),
        env(run)
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        ...result,
        validationRetryCount: 0,
      });
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
  test("does not run AI for unsigned requests", async () => {
    const run = mock(async () => result);
    const response = await handleInternalOp(
      new Request("https://files.teakvault.com/__ops/v1", {
        method: "POST",
        body: "{}",
      }),
      env(run)
    );
    expect(response.status).toBe(401);
    expect(run).toHaveBeenCalledTimes(0);
  });
  test.each([
    { prompt: "x".repeat(6001) },
    { prompt: "ok", url: "http://127.0.0.1" },
    { prompt: 42 },
    { prompt: "" },
  ])("rejects unsafe or unbounded parameters", async (params) => {
    const run = mock(async () => result);
    const response = await handleInternalOp(
      await signedRequest("generate-link-metadata", params),
      env(run)
    );
    expect(response.status).toBe(400);
    expect(run).toHaveBeenCalledTimes(0);
  });
  test("retries malformed output twice with every retry prompt bounded", async () => {
    const run = mock((_model: string, args: Record<string, unknown>) => {
      const messages = args.messages as Array<{ content: string }>;
      expect(messages[1]!.content.length).toBeLessThanOrEqual(6000);
      return Promise.resolve({ response: "not JSON" });
    });
    const response = await handleInternalOp(
      await signedRequest("generate-text-metadata", {
        prompt: "x".repeat(6000),
      }),
      env(run)
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("AI_INVALID_OUTPUT");
    expect(run).toHaveBeenCalledTimes(3);
  });
  test("accepts a corrected validation retry", async () => {
    const run = mock()
      .mockResolvedValueOnce({ response: '{"tags":[42],"summary":"wrong"}' })
      .mockResolvedValueOnce({ response: JSON.stringify(result) });
    const response = await handleInternalOp(
      await signedRequest("generate-text-metadata", { prompt: "Content" }),
      env(run)
    );
    expect((await response.json()).data).toMatchObject(result);
    expect(run).toHaveBeenCalledTimes(2);
  });
  test.each(["rate limit reached 429", "3040 capacity temporarily exceeded"])(
    "surfaces provider capacity without retries: %s",
    async (message) => {
      const run = mock(() => Promise.reject(new Error(message)));
      const response = await handleInternalOp(
        await signedRequest("generate-text-metadata", { prompt: "Content" }),
        env(run)
      );
      expect(response.status).toBe(429);
      expect((await response.json()).error.code).toBe("AI_CAPACITY");
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
  test.each([
    { status: 429, code: undefined, expected: 429 },
    { status: undefined, code: 3040, expected: 429 },
    { status: 400, code: 5004, expected: 500 },
  ])(
    "uses structured provider errors before message text: $expected",
    async ({ status, code, expected }) => {
      const run = mock(() =>
        Promise.reject(
          Object.assign(new Error("Unrelated data includes 429"), {
            status,
            code,
          })
        )
      );
      const response = await handleInternalOp(
        await signedRequest("generate-text-metadata", { prompt: "Content" }),
        env(run)
      );
      expect(response.status).toBe(expected);
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
  test.each([
    {
      status: 502,
      code: undefined,
      message: "AiError 3040 capacity temporarily exceeded",
    },
    { status: 500, code: "3040", message: "Provider failed" },
    { status: "429", code: undefined, message: "Provider failed" },
  ])(
    "defers capacity behind generic HTTP wrappers: $status/$code",
    async ({ status, code, message }) => {
      const run = mock(() =>
        Promise.reject(Object.assign(new Error(message), { status, code }))
      );
      const response = await handleInternalOp(
        await signedRequest("generate-text-metadata", { prompt: "Content" }),
        env(run)
      );
      expect(response.status).toBe(429);
      expect((await response.json()).error.code).toBe("AI_CAPACITY");
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
  test("bounds text and link prompts while retaining beginning and end", () => {
    const content = `beginning${"x".repeat(10_000)}ending`;
    for (const prompt of [
      buildTextMetadataPrompt(content),
      buildLinkMetadataPrompt(content),
    ]) {
      expect(prompt.length).toBe(6000);
      expect(prompt).toContain("beginning");
      expect(prompt).toContain("ending");
      expect(prompt).toContain("Content truncated");
    }
  });
  test("retries provider JSON-validation errors with the same bounded budget", async () => {
    const run = mock().mockRejectedValue(
      new Error("failed_generation: Failed to validate JSON")
    );
    const response = await handleInternalOp(
      await signedRequest("generate-link-metadata", { prompt: "Content" }),
      env(run)
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("AI_INVALID_OUTPUT");
    expect(run).toHaveBeenCalledTimes(3);
  });
  test("reports summed usage across validation retries without content diagnostics", async () => {
    const run = mock()
      .mockResolvedValueOnce({
        response: "malformed",
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      })
      .mockResolvedValueOnce({
        response: JSON.stringify(result),
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    const response = await handleInternalOp(
      await signedRequest("generate-text-metadata", { prompt: "Private text" }),
      env(run)
    );
    expect((await response.json()).data).toEqual({
      ...result,
      validationRetryCount: 1,
      usage: { inputTokens: 18, outputTokens: 7 },
    });
  });
  test("reports validation retries and usage on exhausted output", async () => {
    const run = mock().mockResolvedValue({
      response: "malformed",
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });
    const response = await handleInternalOp(
      await signedRequest("generate-text-metadata", { prompt: "Private text" }),
      env(run)
    );
    const envelope = await response.json();
    expect(envelope.error.aiFacts).toEqual({
      validationRetryCount: 2,
      usage: { inputTokens: 24, outputTokens: 6 },
    });
    expect(JSON.stringify(envelope)).not.toContain("Private text");
  });
});
