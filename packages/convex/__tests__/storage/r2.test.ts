import { describe, expect, test } from "bun:test";
import {
  buildR2DownloadCommand,
  fileDownloadResponsePolicy,
} from "../../storage/r2";

describe("R2 download URLs", () => {
  test("fails closed when legacy file metadata has no filename", () => {
    expect(fileDownloadResponsePolicy(null)).toEqual({
      contentDisposition: "attachment",
      contentType: "application/octet-stream",
    });
  });
  test("request private browser caching for the signed URL lifetime", () => {
    const command = buildR2DownloadCommand("users/example/file.md", "bucket");

    expect(command.input).toMatchObject({
      Bucket: "bucket",
      Key: "users/example/file.md",
      ResponseCacheControl: "private, max-age=900, immutable",
    });
  });

  test("forces browser-active files to download", () => {
    expect(fileDownloadResponsePolicy("payload.html")).toEqual({
      contentDisposition: "attachment",
      contentType: "text/html",
    });
    expect(fileDownloadResponsePolicy("payload.svg")).toEqual({
      contentDisposition: "attachment",
      contentType: "image/svg+xml",
    });
  });

  test("serves passive preview formats with canonical response metadata", () => {
    const policy = fileDownloadResponsePolicy("document.pdf");
    const command = buildR2DownloadCommand(
      "users/example/file.pdf",
      "bucket",
      policy
    );

    expect(command.input).toMatchObject({
      ResponseContentDisposition: "inline",
      ResponseContentType: "application/pdf",
    });
  });

  test("downloads unknown formats as opaque bytes", () => {
    expect(fileDownloadResponsePolicy("payload.unknown-format")).toEqual({
      contentDisposition: "attachment",
      contentType: "application/octet-stream",
    });
  });
});
