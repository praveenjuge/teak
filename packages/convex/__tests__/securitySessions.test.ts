import { describe, expect, mock, test } from "bun:test";
import { UNAUTHENTICATED_ERROR } from "../securitySessions";
import { withTestSession } from "./helpers/session.test-utils";

const signedOut = () =>
  withTestSession({
    auth: { getUserIdentity: mock().mockResolvedValue(null) },
  } as any);

const guarded: [string, () => Promise<unknown>, Record<string, unknown>][] = [
  [
    "folder/folders:createFolder",
    async () => (await import("../folder/folders")).createFolder,
    { name: "Reading" },
  ],
  [
    "folder/membership:addCardsToFolder",
    async () => (await import("../folder/membership")).addCardsToFolder,
    { folderId: "f1", cardIds: [] },
  ],
  [
    "tag/tagOperations:startTagOperation",
    async () => (await import("../tag/tagOperations")).startTagOperation,
    { kind: "delete", from: "old" },
  ],
  [
    "apiKeys:createUserApiKey",
    async () => (await import("../apiKeys")).createUserApiKey,
    { name: "CLI" },
  ],
  [
    "inbound/settings:enable",
    async () => (await import("../inbound/settings")).enable,
    {},
  ],
  [
    "card/thumbnailOverride:createThumbnailUploadUrl",
    async () =>
      (await import("../card/thumbnailOverride")).createThumbnailUploadUrl,
    { cardId: "c1" },
  ],
  [
    "card/deleteCard:permanentDeleteCard",
    async () => (await import("../card/deleteCard")).permanentDeleteCard,
    { id: "c1" },
  ],
  [
    "card/saveLinkedPdf:saveLinkedPdf",
    async () => (await import("../card/saveLinkedPdf")).saveLinkedPdf,
    { cardId: "c1" },
  ],
  [
    "fileUploads:recordMultipartPart",
    async () => (await import("../fileUploads")).recordMultipartPart,
    { sessionId: "s1", partNumber: 1, etag: "e" },
  ],
  [
    "card/getFileUrl:getFileDownloadUrl",
    async () => (await import("../card/getFileUrl")).getFileDownloadUrl,
    { cardId: "c1" },
  ],
];

describe("signed-out calls", () => {
  test.each(guarded)(
    "%s refuses with UNAUTHENTICATED",
    async (_name, load, args) => {
      const registered = (await load()) as any;
      const handler = registered.handler ?? registered;
      await expect(handler(signedOut(), args)).rejects.toMatchObject({
        data: UNAUTHENTICATED_ERROR,
      });
    }
  );
});
