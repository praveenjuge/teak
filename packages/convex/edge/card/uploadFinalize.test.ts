/// <reference types="vite/client" />
import polarTest from "@convex-dev/polar/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../../_generated/api";
import type { ApiCardSource } from "../../card/createCard";
import { buildR2ObjectKey, PENDING_UPLOAD_CARD_ID } from "../../storage/r2";
import { newBackend } from "../helpers.testUtils";

const stubWorker = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        op: string;
        params: Record<string, unknown>;
      };
      const data =
        body.op === "finalize-upload"
          ? {
              destinationKey: body.params.destinationKey,
              sourceEtag: "etag-src",
              storedEtag: "etag-dst",
              storedFileSize: body.params.expectedSize,
              storedMimeType: "application/pdf",
            }
          : { mutationId: "m" };
      return Promise.resolve(
        Response.json({ ok: true, version: 1, requestId: "r", data })
      );
    })
  );

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
  stubWorker();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("finalizing a public API upload", () => {
  const sources: ApiCardSource[] = [
    "api",
    "mcp",
    "cli",
    "raycast",
    "extension",
  ];
  for (const cardSource of sources) {
    test(`saves the card when the caller is ${cardSource}`, async () => {
      const t = newBackend();
      polarTest.register(t);
      await seedWorkosOwner(t, "owner");

      const result = await t.action(
        internal.card.uploadCardAction.finalizeUploadedCardForUser,
        {
          cardSource,
          fileKey: buildR2ObjectKey({
            userId: "owner",
            cardId: PENDING_UPLOAD_CARD_ID,
            role: "file",
            fileName: "paper.pdf",
            objectId: "upload-1",
          }),
          fileName: "paper.pdf",
          fileSize: 2048,
          fileType: "application/pdf",
          userId: "owner",
        }
      );

      expect(result.success).toBe(true);
      const card = await t.run(async (ctx) =>
        result.cardId ? await ctx.db.get("cards", result.cardId) : null
      );
      expect(card).toMatchObject({ type: "document", userId: "owner" });
    });
  }
});
