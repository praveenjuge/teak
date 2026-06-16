// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  ACTIVE_EXPORT_STATUSES,
  EXPORT_QUOTA_WINDOW_MS,
  EXPORT_RETENTION_MS,
  EXPORT_STATUS,
  EXPORT_VERSION,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_CARDS,
  SCHEMA_VERSION,
} from "../../export/constants";
import {
  buildFilePath,
  buildManifest,
  checkExportCaps,
  computeExpiry,
  estimateArtifactSize,
  isActiveCard,
  isExpired,
  isWithinQuota,
  quotaResetInMs,
  sanitizeFilename,
  serializeCard,
  toDualTimestamp,
} from "../../export/serialize";

const baseCard = {
  _id: "card_1",
  type: "image",
  content: "hello world",
  url: "https://example.com",
  notes: "my note",
  tags: ["a", "b"],
  isFavorited: true,
  isDeleted: false,
  fileKey: "users/x/cards/card_1/file/abc",
  fileMetadata: {
    fileSize: 1234,
    fileName: "My Photo (1).PNG",
    mimeType: "image/png",
    width: 800,
    height: 600,
    duration: 12,
  },
  colors: [
    { hex: "#ffffff", name: "White", rgb: { r: 255, g: 255, b: 255 } },
    { hex: "#000000" },
  ],
  // Excluded fields that must never appear in output:
  aiTags: ["ai1"],
  aiSummary: "secret summary",
  aiTranscript: "secret transcript",
  metadata: { source: "ext", linkPreview: { title: "scraped" } },
  thumbnailKey: "users/x/cards/card_1/thumbnail/zzz",
  metadataTitle: "scraped title",
  metadataDescription: "scraped desc",
  visualStyles: ["minimal"],
  colorHexes: ["#ffffff"],
  processingStatus: { classify: { status: "completed" } },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
};

describe("isActiveCard", () => {
  test("includes cards without isDeleted", () => {
    expect(isActiveCard({})).toBe(true);
  });
  test("includes cards with isDeleted=false", () => {
    expect(isActiveCard({ isDeleted: false })).toBe(true);
  });
  test("excludes trashed cards", () => {
    expect(isActiveCard({ isDeleted: true })).toBe(false);
  });
});

describe("toDualTimestamp", () => {
  test("emits ISO and epoch milliseconds", () => {
    const ts = toDualTimestamp(1_700_000_000_000);
    expect(ts.epochMs).toBe(1_700_000_000_000);
    expect(ts.iso).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe("sanitizeFilename", () => {
  test("returns fallback for empty", () => {
    expect(sanitizeFilename(undefined)).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });
  test("strips directories and unsafe characters", () => {
    expect(sanitizeFilename("/etc/../My Photo (1).PNG")).toBe(
      "My-Photo-1-.PNG"
    );
  });
  test("never returns path separators", () => {
    const out = sanitizeFilename("a/b\\c");
    expect(out.includes("/")).toBe(false);
    expect(out.includes("\\")).toBe(false);
  });
});

describe("buildFilePath", () => {
  test("uses files/<cardId>-<name> format", () => {
    expect(buildFilePath("card_1", "photo.png")).toBe("files/card_1-photo.png");
  });
});

describe("serializeCard", () => {
  test("includes only the allow-listed fields", () => {
    const out = serializeCard(baseCard, { includeFile: true });
    expect(out).toEqual({
      id: "card_1",
      type: "image",
      content: "hello world",
      url: "https://example.com",
      notes: "my note",
      tags: ["a", "b"],
      isFavorited: true,
      colors: [{ hex: "#ffffff", name: "White" }, { hex: "#000000" }],
      file: {
        path: "files/card_1-My-Photo-1-.PNG",
        fileName: "My-Photo-1-.PNG",
        mimeType: "image/png",
        fileSize: 1234,
        width: 800,
        height: 600,
        duration: 12,
      },
      createdAt: toDualTimestamp(1_700_000_000_000),
      updatedAt: toDualTimestamp(1_700_000_500_000),
    });
  });

  test("excludes AI, scraped, account, source, thumbnail fields", () => {
    const out = serializeCard(baseCard, { includeFile: true });
    const json = JSON.stringify(out);
    expect(json).not.toContain("secret summary");
    expect(json).not.toContain("secret transcript");
    expect(json).not.toContain("ai1");
    expect(json).not.toContain("scraped");
    expect(json).not.toContain("thumbnail");
    expect(json).not.toContain("visualStyles");
    expect(json).not.toContain("processingStatus");
    expect(out).not.toHaveProperty("aiTags");
    expect(out).not.toHaveProperty("metadata");
    expect(out).not.toHaveProperty("thumbnailKey");
    expect(out).not.toHaveProperty("fileKey");
    expect(out).not.toHaveProperty("colorHexes");
  });

  test("drops rgb/hsl from palette colors, keeps hex + name", () => {
    const out = serializeCard(baseCard, { includeFile: true });
    expect(out.colors).toEqual([
      { hex: "#ffffff", name: "White" },
      { hex: "#000000" },
    ]);
  });

  test("omits file entry when file not included", () => {
    const out = serializeCard(baseCard, { includeFile: false });
    expect(out.file).toBeUndefined();
    expect(out.id).toBe("card_1");
  });

  test("emits timestamps as ISO + epoch", () => {
    const out = serializeCard(baseCard);
    expect(out.createdAt.epochMs).toBe(1_700_000_000_000);
    expect(typeof out.createdAt.iso).toBe("string");
    expect(out.updatedAt.epochMs).toBe(1_700_000_500_000);
  });

  test("handles missing optional fields", () => {
    const out = serializeCard({
      _id: "c2",
      type: "text",
      content: "",
      createdAt: 1,
      updatedAt: 2,
    });
    expect(out.url).toBeUndefined();
    expect(out.notes).toBeUndefined();
    expect(out.colors).toBeUndefined();
    expect(out.tags).toEqual([]);
    expect(out.isFavorited).toBe(false);
  });
});

describe("buildManifest", () => {
  test("includes version, app, counts, retention, timestamps", () => {
    const manifest = buildManifest({
      createdAtMs: 1000,
      expiresAtMs: 2000,
      cardCount: 3,
      filesIncluded: 2,
      filesOmitted: 1,
    });
    expect(manifest.exportVersion).toBe(EXPORT_VERSION);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(manifest.appName).toBe("Teak");
    expect(manifest.retentionMs).toBe(EXPORT_RETENTION_MS);
    expect(manifest.counts).toEqual({
      cards: 3,
      filesIncluded: 2,
      filesOmitted: 1,
    });
    expect(manifest.createdAt.epochMs).toBe(1000);
    expect(manifest.expiresAt.epochMs).toBe(2000);
  });
});

describe("estimateArtifactSize", () => {
  test("sums file sizes plus per-card allowance", () => {
    const size = estimateArtifactSize([
      { fileMetadata: { fileSize: 1000 } },
      { fileMetadata: { fileSize: 2000 } },
      {},
    ]);
    // 3000 file bytes + 3 * 2048 json allowance
    expect(size).toBe(3000 + 3 * 2048);
  });
});

describe("checkExportCaps", () => {
  test("passes for a small library", () => {
    const result = checkExportCaps([{ fileMetadata: { fileSize: 10 } }]);
    expect(result.ok).toBe(true);
    expect(result.cardCount).toBe(1);
  });

  test("fails when exceeding the card cap", () => {
    const cards = Array.from({ length: MAX_EXPORT_CARDS + 1 }, () => ({}));
    const result = checkExportCaps(cards);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_many_cards");
  });

  test("fails when exceeding the byte cap", () => {
    const result = checkExportCaps([
      { fileMetadata: { fileSize: MAX_EXPORT_BYTES + 1 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_large");
  });
});

describe("weekly quota", () => {
  test("allows when no prior successful export", () => {
    expect(isWithinQuota(undefined, Date.now())).toBe(true);
  });
  test("blocks within the rolling window", () => {
    const now = 1_000_000_000_000;
    const last = now - (EXPORT_QUOTA_WINDOW_MS - 1000);
    expect(isWithinQuota(last, now)).toBe(false);
    expect(quotaResetInMs(last, now)).toBe(1000);
  });
  test("allows after the window elapses", () => {
    const now = 1_000_000_000_000;
    const last = now - EXPORT_QUOTA_WINDOW_MS;
    expect(isWithinQuota(last, now)).toBe(true);
    expect(quotaResetInMs(last, now)).toBe(0);
  });
});

describe("expiry", () => {
  test("computeExpiry adds retention", () => {
    expect(computeExpiry(1000)).toBe(1000 + EXPORT_RETENTION_MS);
  });
  test("isExpired true at/after expiry", () => {
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1000, 999)).toBe(false);
    expect(isExpired(undefined, 5000)).toBe(false);
  });
});

describe("lifecycle constants", () => {
  test("active statuses are pending + running only", () => {
    expect(ACTIVE_EXPORT_STATUSES).toEqual([
      EXPORT_STATUS.PENDING,
      EXPORT_STATUS.RUNNING,
    ]);
  });
});
