import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = "upload-owner";
const PART = 8 * 1024 * 1024;

async function setup() {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_uploads",
    email_verified: true,
    external_id: OWNER,
  });
  const now = Date.now();
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("fileUploadSessions", {
      userId: OWNER,
      teakUserId: OWNER,
      sourceKey: "users/x/cards/upload-pending-v2/file/movie.mp4",
      uploadId: "upload_1",
      fileName: "movie.mp4",
      fileSize: 3 * PART,
      fileType: "video/mp4",
      fileLastModified: 1,
      partSize: PART,
      parts: [],
      status: "uploading",
      expiresAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    })
  );
  return { t, owner, sessionId };
}

test("refuses a part number that isn't a whole number", async () => {
  const { t, owner, sessionId } = await setup();
  await expect(
    owner.mutation(api.fileUploads.recordMultipartPart, {
      sessionId,
      partNumber: 1.5,
      etag: "etag-a",
      size: PART,
    })
  ).rejects.toThrow("Uploaded part metadata is invalid");
  const session = await t.run((ctx) => ctx.db.get(sessionId));
  expect(session?.parts).toEqual([]);
});

test("records a whole part number", async () => {
  const { t, owner, sessionId } = await setup();
  await owner.mutation(api.fileUploads.recordMultipartPart, {
    sessionId,
    partNumber: 2,
    etag: "etag-b",
    size: PART,
  });
  const session = await t.run((ctx) => ctx.db.get(sessionId));
  expect(session?.parts).toEqual([
    { partNumber: 2, etag: "etag-b", size: PART },
  ]);
});
