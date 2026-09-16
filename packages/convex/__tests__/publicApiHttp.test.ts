// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  createCardV1,
  createUploadV1,

} from "../publicApiHttp";
import { MAX_FILE_SIZE } from "../shared/constants";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "./helpers/publicApiHttp.test-utils";

describe("publicApiHttp create endpoints", () => {
  test("createCardV1 returns 405 for non-POST methods", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "GET",
      })
    );

    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("createCardV1 returns 401 without bearer token", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("UNAUTHORIZED");
  });

  test("createCardV1 returns 429 when rate limited", async () => {
    const runMutation = mock()
      // validate succeeds first...
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
        source: "component",
        rateLimitKey: "component:key_1",
      })
      // ...then the per-key rate limit rejects.
      .mockResolvedValueOnce({
        ok: false,
        retryAt: Date.now() + 30_000,
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
    expect(typeof payload.retryAt).toBe("number");
  });

  test("createCardV1 maps rate limit contention errors to 429", async () => {
    const runMutation = mock()
      // validate succeeds first...
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
        source: "component",
        rateLimitKey: "component:key_1",
      })
      // ...then the per-key rate limit hits document contention.
      .mockRejectedValueOnce(
        new Error(
          'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
        )
      );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
  });

  test("createCardV1 maps serialized rate limit contention errors to 429", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
        source: "component",
        rateLimitKey: "component:key_1",
      })
      .mockRejectedValueOnce({
        message:
          'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.',
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  test("createCardV1 returns 500 when auth mutation throws unexpected error", async () => {
    const runMutation = mock().mockRejectedValueOnce(
      new Error("db unavailable")
    );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_ERROR",
      error: "Failed to authorize request",
    });
  });

  test("createCardV1 returns 401 without consuming a rate limit for malformed keys", async () => {
    // Malformed tokens must skip key validation entirely and only touch the
    // shared invalid-auth bucket, so exactly one mutation should run.
    const runMutation = mock().mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          // Missing the secret segment -> structurally invalid.
          Authorization: "Bearer teakapi_abc",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
    // Only the invalid-auth bucket consume runs; validation is never reached.
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("createCardV1 rejects a retired legacy-shaped bearer token with 401", async () => {
    // The old `teakapi_<prefix>_<secret>` (3-segment) shape is no longer a
    // well-formed key, so it is treated as invalid and never reaches
    // validation.
    const runMutation = mock().mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc12345_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
    // Only the shared invalid-auth bucket is consumed; validation never runs.
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("createCardV1 accepts component-format API keys before validation", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = mock()
      .mockResolvedValueOnce({
        access: "full_access",
        keyId: "component_key",
        rateLimitKey: "component:component_key",
        source: "component",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ ok: true, retryAt: undefined })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        cardId: "card_1",
        status: "created",
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0][1]).toEqual({
      token,
    });
    expect(runMutation.mock.calls[1][1]).toEqual({
      rateLimitKey: "key:component:component_key",
    });
  });

  test("createCardV1 rejects supplied string fields with the wrong type", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMock();

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardType: 123, url: "https://example.com" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("createUploadV1 prepares a presigned upload for an authorized user", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      expiresIn: 600,
      fileKey: "users/user_1/file/image.png",
      maxFileSize: MAX_FILE_SIZE,
      method: "PUT",
      uploadUrl: "https://upload.example",
    });

    const response = await runHandler(
      createUploadV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/uploads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresIn: 600,
      fileKey: "users/user_1/file/image.png",
      maxFileSize: MAX_FILE_SIZE,
      method: "PUT",
      uploadUrl: "https://upload.example",
    });
    expect(runMutation.mock.calls[2][1]).toEqual({
      fileName: "image.png",
      fileSize: 123,
      mimeType: "image/png",
      userId: "user_1",
    });
  });

  test("createUploadV1 maps invalid MIME and oversized upload validation", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    for (const scenario of [
      {
        body: {
          fileName: "component.tsx",
          fileSize: 20,
          mimeType: "image/png",
        },
        code: "TYPE_MISMATCH",
        message: "File extension does not match the provided MIME type",
      },
      {
        body: {
          fileName: "archive.zip",
          fileSize: MAX_FILE_SIZE + 1,
          mimeType: "application/zip",
        },
        code: "FILE_TOO_LARGE",
        message: `fileSize must not exceed ${MAX_FILE_SIZE} bytes`,
      },
    ]) {
      const runMutation = buildAuthorizedMutationMock().mockRejectedValueOnce(
        new ConvexError({ code: scenario.code, message: scenario.message })
      );
      const response = await runHandler(
        createUploadV1,
        { runMutation, runQuery: mock() },
        new Request("https://example.com/v1/uploads", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(scenario.body),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: scenario.code,
        error: scenario.message,
      });
    }
  });

  test("createCardV1 finalizes fileKey uploads through the canonical action", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockResolvedValueOnce({
      success: true,
      cardId: "card_file",
    });
    const runQuery = mock();
    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileEtag: '"upload-etag"',
          fileKey: "users/user_1/file/image.png",
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
          tags: ["reference"],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cardId: "card_file",
      status: "created",
    });
    expect(runAction.mock.calls[0][1]).toMatchObject({
      cardType: "image",
      fileEtag: '"upload-etag"',
      fileKey: "users/user_1/file/image.png",
      fileName: "image.png",
      fileSize: 123,
      fileType: "image/png",
      tags: ["reference"],
      userId: "user_1",
    });
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("createCardV1 forwards explicit text Markdown without normalization", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const content =
      "\uFEFF  # Heading\r\n\r\n- [ ] task  \r\nhttps://example.com  ";
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce({
        cardId: "card_text",
        status: "created",
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardType: "text", content }),
      })
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[3]?.[1]).toMatchObject({
      cardType: "text",
      content,
      userId: "user_1",
    });
  });

  test("createCardV1 only allows whitespace content for explicit text cards", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const textMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce({
        cardId: "card_text",
        status: "created",
      });
    const request = (cardType: "quote" | "text") =>
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardType, content: "  \r\n" }),
      });

    const textResponse = await runHandler(
      createCardV1,
      { runMutation: textMutation, runQuery: mock() },
      request("text")
    );
    const quoteResponse = await runHandler(
      createCardV1,
      {
        runMutation: buildAuthorizedMutationMockWithIdempotencySkip(),
        runQuery: mock(),
      },
      request("quote")
    );

    expect(textResponse.status).toBe(200);
    expect(textMutation.mock.calls[3]?.[1]).toMatchObject({
      cardType: "text",
      content: "  \r\n",
    });
    expect(quoteResponse.status).toBe(400);
  });

  test("createCardV1 preserves stable text-size errors", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockRejectedValueOnce(
        new ConvexError({
          code: "CONTENT_TOO_LARGE",
          message:
            "Text card content must not exceed 512 KiB when encoded as UTF-8.",
        })
      );
    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "text",
          content: `${"a".repeat(512 * 1024)}b`,
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "CONTENT_TOO_LARGE",
      error: "Text card content must not exceed 512 KiB when encoded as UTF-8.",
    });
  });

  test("createCardV1 infers an uploaded file type when cardType is omitted", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockResolvedValueOnce({
      success: true,
      cardId: "card_source",
    });

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileKey: "users/user_1/file/component.tsx",
          fileName: "component.tsx",
          fileSize: 321,
          mimeType: "text/tsx",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cardId: "card_source" });
    expect(runAction.mock.calls[0]?.[1]).toMatchObject({
      cardType: undefined,
      fileName: "component.tsx",
      fileType: "text/tsx",
    });
  });

  test("createCardV1 rejects fileKey uploads when direct metadata omits size", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockRejectedValueOnce(
      new ConvexError({
        code: "INVALID_INPUT",
        message: "Uploaded file metadata is unavailable",
      })
    );

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileKey: "users/user_1/file/image.png",
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
          tags: ["reference"],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_INPUT",
      error: "Uploaded file metadata is unavailable",
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  test("createCardV1 rejects fileKey uploads when the object is missing", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockRejectedValue(
      new ConvexError({
        code: "INVALID_INPUT",
        message: "Uploaded file was not found",
      })
    );

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileKey: "users/user_1/file/missing.png",
          fileName: "missing.png",
          fileSize: 123,
          mimeType: "image/png",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_INPUT",
      error: "Uploaded file was not found",
    });
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  test("createCardV1 accepts a successful canonical upload finalization", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockResolvedValueOnce({
      success: true,
      cardId: "card_file",
    });

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileKey: "users/user_1/file/image.svg",
          fileName: "image.svg",
          fileSize: 123,
          mimeType: "image/svg+xml",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cardId: "card_file" });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test("createCardV1 rejects fileKey uploads when stored metadata differs", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockRejectedValueOnce(
      new ConvexError({
        code: "INVALID_INPUT",
        message: "Uploaded file size does not match the stored object",
      })
    );

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileKey: "users/user_1/file/image.png",
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_INPUT",
      error: "Uploaded file size does not match the stored object",
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  test("createCardV1 reports stored MIME mismatches consistently", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockRejectedValueOnce(
      new ConvexError({
        code: "TYPE_MISMATCH",
        message: "File extension does not match the provided MIME type",
      })
    );

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileKey: "users/user_1/file/image.png",
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "TYPE_MISMATCH",
      error: "File extension does not match the provided MIME type",
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  test("createCardV1 rejects fileKey uploads when stored object is too large", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
    const runAction = mock().mockRejectedValueOnce(
      new ConvexError({
        code: "FILE_TOO_LARGE",
        message: `Uploaded file must not exceed ${MAX_FILE_SIZE} bytes`,
      })
    );

    const response = await runHandler(
      createCardV1,
      { runAction, runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardType: "image",
          fileKey: "users/user_1/file/large.png",
          fileName: "large.png",
          mimeType: "image/png",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "FILE_TOO_LARGE",
      error: `Uploaded file must not exceed ${MAX_FILE_SIZE} bytes`,
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});
