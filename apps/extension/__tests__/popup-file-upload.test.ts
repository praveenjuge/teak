// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const popupSource = readFileSync(
  join(import.meta.dir, "../entrypoints/popup/App.tsx"),
  "utf8"
);

test("popup exposes user-selected file upload through the canonical saver", () => {
  expect(popupSource).toContain('type="file"');
  expect(popupSource).toContain("saveFileToTeak(");
  expect(popupSource).toContain('source: "popup-file"');
  expect(popupSource).toContain("Upload file");
});

test("popup keeps upload failures in its existing visible error state", () => {
  expect(popupSource).toContain('result.status === "error"');
  expect(popupSource).toContain("setFileUploadError(");
  expect(popupSource).toContain('fileUploadState === "error"');
  expect(popupSource).toContain("{fileUploadError}");
});
