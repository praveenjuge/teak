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
import { createConnectAuthorizeUrl } from "@teak/convex/sdk";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import type { Command } from "commander";
import {
  bulkItems,
  formatCardLine,
  getUploadFileInfo,
  listingJson,
  mimeFor,
  parseSeed,
  parseSort,
  program,
  queryOptions,
} from ".";
import { resolveAddInput } from "./files";
import { credentialSourceOrder, VERSION } from "./runtime";

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
    expect(
      inferFileFormat({ fileName: "README.MD", mimeType: "text/markdown" })
        ?.cardType
    ).toBe("text");
    expect(
      inferFileFormat({ fileName: "readme.mdx", mimeType: "text/mdx" })
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

    const oversizedMarkdownPath = join(fixtureDirectory, "oversized.md");
    writeFileSync(oversizedMarkdownPath, "");
    truncateSync(oversizedMarkdownPath, 512 * 1024 + 1);
    expect(() => getUploadFileInfo(oversizedMarkdownPath)).toThrow(
      "512 KiB when encoded as UTF-8"
    );
  });

  test("explicit file input wins before stdin is read", async () => {
    await expect(resolveAddInput(undefined, "/tmp/image.png")).resolves.toEqual(
      {
        candidate: "/tmp/image.png",
        raw: "",
      }
    );
  });

  test("keeps positional Markdown whitespace intact", async () => {
    const raw = "\uFEFF  # Heading\r\n\r\nBody  \n";
    await expect(resolveAddInput(raw, undefined)).resolves.toEqual({
      candidate: raw,
      raw,
    });
  });

  test("rejects invalid sort values", () => {
    expect(parseSort("oldest")).toBe("oldest");
    expect(parseSort("shuffle")).toBe("shuffle");
    expect(() => parseSort("newestt")).toThrow(
      "sort must be newest, oldest or shuffle"
    );
  });

  test("a shuffled listing's JSON carries its seed", () => {
    const page = { items: [], pageInfo: { hasMore: true, nextCursor: "c" } };
    expect(listingJson(page, 42)).toEqual({ ...page, seed: 42 });
    expect(listingJson(page, undefined)).toEqual(page);
  });

  test("shuffle passes its seed, and seeds must be whole numbers", () => {
    expect(parseSeed("42")).toBe(42);
    expect(() => parseSeed("4.2")).toThrow("seed must be a whole number");
    expect(() => parseSeed("-1")).toThrow("seed must be a whole number");
    expect(queryOptions({ sort: "shuffle", seed: 42 })).toMatchObject({
      sort: "shuffle",
      shuffleSeed: 42,
    });
    expect(queryOptions({ sort: "newest", seed: 42 })).not.toHaveProperty(
      "shuffleSeed"
    );
  });

  test("uses package version for CLI output", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(VERSION).toBe(manifest.version);
  });

  test("requests refresh-capable OAuth scope during login", () => {
    const url = createConnectAuthorizeUrl(
      {
        primary: "workos",
        issuer: "https://auth.teakvault.com",
        authorizationEndpoint: "https://auth.teakvault.com/oauth2/authorize",
        tokenEndpoint: "https://auth.teakvault.com/oauth2/token",
        resource: "https://teakvault.com/mcp",
        clients: {
          cli: "client_01CLI",
          raycast: "client_01RAYCAST",
          chrome: "client_01CHROME",
          firefox: "client_01FIREFOX",
        },
      },
      {
        clientId: "client_01CLI",
        codeChallenge: "challenge",
        redirectUri: "http://127.0.0.1:14210/oauth/callback",
        state: "state",
      }
    );

    expect(url.searchParams.get("client_id")).toBe("client_01CLI");
    expect(url.searchParams.get("resource")).toBe("https://teakvault.com/api");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email offline_access"
    );
  });
});

describe("teak cli help", () => {
  const commandsWithoutDescription = (command: Command, prefix: string) =>
    command.commands.flatMap((sub): string[] => {
      const name = `${prefix} ${sub.name()}`;
      return [
        ...(sub.description().trim() ? [] : [name]),
        ...commandsWithoutDescription(sub, name),
      ];
    });

  test("every command has a --help description", () => {
    expect(commandsWithoutDescription(program, "teak")).toEqual([]);
  });
});

describe("teak bulk input", () => {
  test.each([
    ["a bare array", [{ content: "a" }]],
    ["the API's {items} body", { items: [{ content: "a" }] }],
  ])("accepts %s", (_label, input) => {
    expect(bulkItems(input)).toEqual([{ content: "a" }]);
  });

  test.each([null, "text", { cards: [] }, { items: "x" }])(
    "rejects %p",
    (input) => {
      expect(bulkItems(input)).toBeNull();
    }
  );
});

describe("teak credential storage", () => {
  const saved = { accessToken: "a", refreshToken: "r", expiresAt: 0 };

  test("an old fallback file loses to Keychain", () => {
    expect(credentialSourceOrder(JSON.stringify(saved))).toEqual([
      "keychain",
      "file",
    ]);
    expect(credentialSourceOrder("")).toEqual(["keychain", "file"]);
  });

  test("a fallback file written after a failed Keychain update wins", () => {
    expect(
      credentialSourceOrder(
        JSON.stringify({ ...saved, fallbackAuthority: true })
      )
    ).toEqual(["file"]);
  });
});
