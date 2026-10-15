import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { deleteStorageObjects } from "../../workflows/objectCleanup";

const saved = {
  base: process.env.FILES_BASE,
  secret: process.env.FILES_SIGNING_SECRET,
};

describe("storage object deletion", () => {
  beforeEach(() => {
    delete process.env.FILES_BASE;
    delete process.env.FILES_SIGNING_SECRET;
  });
  afterEach(() => {
    for (const [name, value] of [
      ["FILES_BASE", saved.base],
      ["FILES_SIGNING_SECRET", saved.secret],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  test.each([[[] as string[]], [[""]]])(
    "deleting no keys needs no Files Worker, so text-only accounts delete without file storage (%j)",
    async (keys: string[]) => {
      await expect(deleteStorageObjects(keys)).resolves.toEqual({
        deleted: 0,
      });
    }
  );

  test("deleting stored objects without a Files Worker fails", async () => {
    await expect(
      deleteStorageObjects(["users/abc/cards/file/x.png"])
    ).rejects.toThrow("files_worker_not_configured");
  });
});
