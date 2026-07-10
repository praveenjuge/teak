// @ts-nocheck

import { beforeAll, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { MAX_FILE_SIZE } from "../shared/fileFormats";

let generateUploadUrlHandler: any;

beforeAll(async () => {
  const { generateUploadUrlForUser } = await import("../publicApiUploads");
  generateUploadUrlHandler =
    (generateUploadUrlForUser as any).handler ?? generateUploadUrlForUser;
});

describe("public API uploads", () => {
  for (const scenario of [
    {
      args: {
        fileName: "component.tsx",
        fileSize: 20,
        mimeType: "image/png",
        userId: "user_1",
      },
      code: "TYPE_MISMATCH",
    },
    {
      args: {
        fileName: "archive.zip",
        fileSize: MAX_FILE_SIZE + 1,
        mimeType: "application/zip",
        userId: "user_1",
      },
      code: "FILE_TOO_LARGE",
    },
  ]) {
    test(`maps upload validation to ${scenario.code}`, async () => {
      let thrown: unknown;
      try {
        await generateUploadUrlHandler({}, scenario.args);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ConvexError);
      expect((thrown as ConvexError<{ code: string }>).data.code).toBe(
        scenario.code
      );
    });
  }
});
