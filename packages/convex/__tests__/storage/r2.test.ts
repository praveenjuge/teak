import { describe, expect, test } from "bun:test";
import { buildR2DownloadCommand } from "../../storage/r2";

describe("R2 download URLs", () => {
  test("request private browser caching for the signed URL lifetime", () => {
    const command = buildR2DownloadCommand("users/example/file.md", "bucket");

    expect(command.input).toMatchObject({
      Bucket: "bucket",
      Key: "users/example/file.md",
      ResponseCacheControl: "private, max-age=900, immutable",
    });
  });
});
