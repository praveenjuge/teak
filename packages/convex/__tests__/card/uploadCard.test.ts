import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { internal } from "../../_generated/api";
import { validateFinalizeUpload } from "../../card/uploadCardAction";
import { requireTeakUserId, type TeakUserId } from "../../securitySessions";
import { buildR2ObjectKey } from "../../storage/r2";
import {
  withMappedOwner,
  withTestSession,
} from "../helpers/session.test-utils";

describe("worker-backed card upload finalization", () => {
  let userId: TeakUserId;
  beforeAll(async () => {
    userId = await requireTeakUserId(withMappedOwner({}) as any, "user-1");
  });

  test("accepts a valid user-scoped key including consecutive dots", () => {
    const fileKey = buildR2ObjectKey({
      userId,
      cardId: "upload-pending-v2",
      role: "file",
      fileName: "design..final.png",
    });
    expect(
      validateFinalizeUpload(userId, {
        fileEtag: '"etag-1"',
        fileKey,
        fileName: "design..final.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toMatchObject({
      fileName: "design..final.png",
      markdown: false,
      requestedMimeType: "image/png",
    });
  });

  test("rejects storage keys belonging to another user", () => {
    const fileKey = buildR2ObjectKey({
      userId: "other-user",
      role: "file",
      fileName: "photo.png",
    });
    expect(() =>
      validateFinalizeUpload(userId, {
        fileKey,
        fileName: "photo.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toThrow("Uploaded file key does not belong to the current user");
  });

  test("normalizes weak Cloudflare ETags before finalization", () => {
    const fileKey = buildR2ObjectKey({ userId, role: "file" });
    expect(
      validateFinalizeUpload(userId, {
        fileEtag: 'W/"etag-1"',
        fileKey,
        fileName: "photo.png",
        fileSize: 128,
        fileType: "image/png",
      }).fileEtag
    ).toBe('"etag-1"');
  });

  test("rejects malformed etags and oversized files before storage work", () => {
    const fileKey = buildR2ObjectKey({ userId, role: "file" });
    expect(() =>
      validateFinalizeUpload(userId, {
        fileEtag: "bad etag",
        fileKey,
        fileName: "photo.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toThrow("Uploaded file ETag is invalid");
  });
});

describe("direct upload URLs", () => {
  const saved = {
    FILES_BASE: process.env.FILES_BASE,
    FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  };
  let originalGetSubscription: any;

  beforeAll(async () => {
    const { polar } = await import("../../billing");
    originalGetSubscription = polar.getCurrentSubscription;
    polar.getCurrentSubscription = (async () => null) as any;
    process.env.FILES_BASE = "https://files.test";
    process.env.FILES_SIGNING_SECRET = "test-secret";
  });

  afterAll(async () => {
    const { polar } = await import("../../billing");
    polar.getCurrentSubscription = originalGetSubscription;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("issues an upload URL without spending a card-creation rate-limit token", async () => {
    const { uploadAndCreateCard } = await import("../../card/uploadCard");
    const registerObject = getFunctionName(
      internal.storage.ownership.registerObject
    );
    const runMutation = mock(async (ref: any) =>
      getFunctionName(ref) === registerObject
        ? true
        : { ok: false, retryAfter: 60_000 }
    );
    const ctx = withTestSession({
      auth: { getUserIdentity: async () => ({ subject: "u1" }) },
      db: {
        get: async () => null,
        query: () => ({
          withIndex: () => ({
            unique: async () => null,
            first: async () => null,
            take: async () => [],
          }),
        }),
      },
      runMutation,
    } as any);

    const result = await (uploadAndCreateCard as any)._handler(ctx, {
      fileName: "photo.png",
      fileSize: 128,
      fileType: "image/png",
    });

    expect(result).toMatchObject({ success: true });
    expect(result.uploadUrl).toStartWith("https://files.test/");
  });
});

describe("finalized upload cleanup", () => {
  test("closes the upload session and queues the source object for durable deletion", async () => {
    const { consumeSessionBySourceKey } = await import("../../fileUploads");
    const handler =
      (consumeSessionBySourceKey as any)._handler ??
      (consumeSessionBySourceKey as any).handler;
    const sourceKey = buildR2ObjectKey({
      userId: "user-1",
      cardId: "upload-pending-v2",
      role: "file",
      fileName: "photo.png",
    });
    const deleted: string[] = [];
    const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
    const scheduled: string[] = [];
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => [],
            unique: async () => ({ _id: "session-1", sourceKey }),
          }),
        }),
        delete: (id: string) => {
          deleted.push(id);
          return Promise.resolve();
        },
        insert: (table: string, row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return Promise.resolve(`row-${inserted.length}`);
        },
      },
      scheduler: {
        runAfter: (_delay: number, fn: unknown) => {
          scheduled.push(getFunctionName(fn as any));
          return Promise.resolve();
        },
      },
    };

    await handler(ctx, { sourceKey });

    expect(deleted).toEqual(["session-1"]);
    expect(inserted).toMatchObject([
      {
        table: "workflowDispatches",
        row: { kind: "deleteObjects", keys: [sourceKey], state: "pending" },
      },
    ]);
    expect(scheduled).toEqual([
      getFunctionName(internal.workflowDispatch.flush),
    ]);
  });
});
