import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import { formatCardLine, getUploadFileInfo, mimeFor, parseSort } from ".";
import { resolveAddInput } from "./files";
import { CLI_OAUTH_SCOPE, createAuthorizeUrl, VERSION } from "./runtime";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "teak-cli-files-"));

afterAll(() => {
  rmSync(fixtureDirectory, { force: true, recursive: true });
});

describe("teak cli formatting", () => {
  test("formats stable one-line cards", () => {
    const line = formatCardLine({
      content: "A useful design note with a little extra text for truncation",
      createdAt: Date.now() - 120_000,
      id: "card_1",
      tags: ["design", "cli"],
      type: "text",
    });
    expect(line).toContain("card_1");
    expect(line).toContain("text");
    expect(line).toContain("#design #cli");
  });

  test("maps file extensions and MIME types for uploads", () => {
    expect(mimeFor("/tmp/a.png")).toBe("image/png");
    expect(mimeFor("/tmp/component.tsx")).toBe("text/tsx");
    expect(mimeFor("/tmp/brand.tokens.json")).toBe("application/json");
    expect(mimeFor("/tmp/animation.gif")).toBe("image/gif");
    expect(mimeFor("/tmp/a.unknown")).toBe("application/octet-stream");
    expect(
      inferFileFormat({ fileName: "animation.gif", mimeType: "image/gif" })
        ?.cardType
    ).toBe("video");
    expect(
      inferFileFormat({ fileName: "document.pdf", mimeType: "application/pdf" })
        ?.cardType
    ).toBe("document");
  });

  test("covers representative expanded upload formats", () => {
    const expected = new Map([
      ["component.tsx", "text/tsx"],
      ["readme.mdx", "text/mdx"],
      ["bundle.zip", "application/zip"],
      ["vector.svg", "image/svg+xml"],
      ["motion.gif", "image/gif"],
      ["design.fig", "application/octet-stream"],
    ]);
    for (const [fileName, mimeType] of expected) {
      expect(mimeFor(fileName)).toBe(mimeType);
    }
  });

  test("rejects unknown and oversized files before network calls", () => {
    const unknownPath = join(fixtureDirectory, "unknown.riv");
    writeFileSync(unknownPath, "riv");
    expect(() => getUploadFileInfo(unknownPath)).toThrow(
      "unsupported file type"
    );

    const oversizedPath = join(fixtureDirectory, "oversized.zip");
    writeFileSync(oversizedPath, "");
    truncateSync(oversizedPath, 100 * 1024 * 1024 + 1);
    expect(() => getUploadFileInfo(oversizedPath)).toThrow("at most");
  });

  test("explicit file input wins before stdin is read", async () => {
    await expect(resolveAddInput(undefined, "/tmp/image.png")).resolves.toEqual(
      {
        candidate: "/tmp/image.png",
        raw: "",
      }
    );
  });

  test("rejects invalid sort values", () => {
    expect(parseSort("oldest")).toBe("oldest");
    expect(() => parseSort("newestt")).toThrow("sort must be newest or oldest");
  });

  test("uses package version for CLI output", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(VERSION).toBe(manifest.version);
  });

  test("requests refresh-capable OAuth scope during login", () => {
    const url = createAuthorizeUrl(
      { authUrl: "https://app.teakvault.com" },
      {
        codeChallenge: "challenge",
        redirectUri: "http://127.0.0.1:14210/oauth/callback",
        state: "state",
      }
    );

    expect(url.searchParams.get("client_id")).toBe("teak-cli");
    expect(url.searchParams.get("scope")).toBe(CLI_OAUTH_SCOPE);
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });
});
