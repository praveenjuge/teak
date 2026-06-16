// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildExportArchive } from "../../export/archiveBuilder";

const enc = new TextEncoder();

function makeCard(id, overrides = {}) {
  return {
    _id: id,
    type: "image",
    content: `content-${id}`,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function unzip(buffer) {
  return unzipSync(new Uint8Array(buffer));
}

describe("buildExportArchive", () => {
  test("produces manifest.json, cards.json and files for included originals", async () => {
    const inputs = [
      {
        card: makeCard("c1", {
          fileMetadata: { fileName: "a.png", fileSize: 3, mimeType: "image/png" },
        }),
        fileKey: "key-c1",
      },
      {
        card: makeCard("c2", { type: "text", content: "no file" }),
      },
    ];

    const reader = async (key) =>
      key === "key-c1" ? enc.encode("PNG") : null;

    const result = await buildExportArchive({
      inputs,
      readFile: reader,
      createdAtMs: 1000,
      expiresAtMs: 2000,
    });

    expect(result.cardCount).toBe(2);
    expect(result.filesIncluded).toBe(1);
    expect(result.filesOmitted).toBe(0);

    const entries = unzip(result.buffer);
    const names = Object.keys(entries).sort();
    expect(names).toEqual([
      "cards.json",
      "files/c1-a.png",
      "manifest.json",
    ]);

    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.exportVersion).toBe(1);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.appName).toBe("Teak");
    expect(manifest.counts).toEqual({
      cards: 2,
      filesIncluded: 1,
      filesOmitted: 0,
    });

    const cardsDoc = JSON.parse(strFromU8(entries["cards.json"]));
    expect(cardsDoc.cards).toHaveLength(2);
    const c1 = cardsDoc.cards.find((c) => c.id === "c1");
    expect(c1.file.path).toBe("files/c1-a.png");
    const c2 = cardsDoc.cards.find((c) => c.id === "c2");
    expect(c2.file).toBeUndefined();

    expect(strFromU8(entries["files/c1-a.png"])).toBe("PNG");
  });

  test("retries once then omits missing files; card stays without file path", async () => {
    let attempts = 0;
    const reader = async () => {
      attempts += 1;
      return null; // always missing
    };

    const inputs = [
      {
        card: makeCard("c1", { fileMetadata: { fileName: "x.bin" } }),
        fileKey: "missing-key",
      },
    ];

    const result = await buildExportArchive({
      inputs,
      readFile: reader,
      createdAtMs: 1,
      expiresAtMs: 2,
    });

    // Two total attempts (initial + one retry).
    expect(attempts).toBe(2);
    expect(result.filesIncluded).toBe(0);
    expect(result.filesOmitted).toBe(1);
    expect(result.omittedCardIds).toEqual(["c1"]);

    const entries = unzip(result.buffer);
    expect(Object.keys(entries).sort()).toEqual(["cards.json", "manifest.json"]);

    const cardsDoc = JSON.parse(strFromU8(entries["cards.json"]));
    expect(cardsDoc.cards[0].id).toBe("c1");
    expect(cardsDoc.cards[0].file).toBeUndefined();

    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.counts.filesOmitted).toBe(1);
    expect(manifest.counts.filesIncluded).toBe(0);
  });

  test("recovers on retry when the second read succeeds", async () => {
    let attempts = 0;
    const reader = async () => {
      attempts += 1;
      return attempts >= 2 ? enc.encode("ok") : null;
    };

    const result = await buildExportArchive({
      inputs: [
        {
          card: makeCard("c1", { fileMetadata: { fileName: "y.txt" } }),
          fileKey: "flaky",
        },
      ],
      readFile: reader,
      createdAtMs: 1,
      expiresAtMs: 2,
    });

    expect(result.filesIncluded).toBe(1);
    expect(result.filesOmitted).toBe(0);
    const entries = unzip(result.buffer);
    expect(strFromU8(entries["files/c1-y.txt"])).toBe("ok");
  });

  test("produces a valid empty archive for an empty library", async () => {
    const result = await buildExportArchive({
      inputs: [],
      readFile: async () => null,
      createdAtMs: 1,
      expiresAtMs: 2,
    });

    expect(result.cardCount).toBe(0);
    const entries = unzip(result.buffer);
    expect(Object.keys(entries).sort()).toEqual(["cards.json", "manifest.json"]);
    const cardsDoc = JSON.parse(strFromU8(entries["cards.json"]));
    expect(cardsDoc.cards).toEqual([]);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.counts.cards).toBe(0);
  });

  test("treats empty byte arrays as missing files", async () => {
    const result = await buildExportArchive({
      inputs: [
        {
          card: makeCard("c1", { fileMetadata: { fileName: "z.bin" } }),
          fileKey: "empty",
        },
      ],
      readFile: async () => new Uint8Array(0),
      createdAtMs: 1,
      expiresAtMs: 2,
    });
    expect(result.filesOmitted).toBe(1);
    expect(result.filesIncluded).toBe(0);
  });

  test("does not leak excluded fields into cards.json", async () => {
    const result = await buildExportArchive({
      inputs: [
        {
          card: makeCard("c1", {
            aiSummary: "secret",
            aiTranscript: "secret-t",
            metadata: { linkPreview: { title: "scraped" } },
            thumbnailKey: "thumb",
          }),
        },
      ],
      readFile: async () => null,
      createdAtMs: 1,
      expiresAtMs: 2,
    });
    const entries = unzip(result.buffer);
    const cardsText = strFromU8(entries["cards.json"]);
    expect(cardsText).not.toContain("secret");
    expect(cardsText).not.toContain("scraped");
    expect(cardsText).not.toContain("thumb");
  });
});
