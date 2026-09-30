import { afterEach, describe, expect, test } from "bun:test";
import { attachFileUrls, attachGridFileUrls } from "../../card/queryUtils";

const PREVIOUS = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};

afterEach(() => {
  for (const [name, value] of Object.entries(PREVIOUS)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

const card = (overrides: Record<string, unknown>) =>
  ({
    _creationTime: 1,
    _id: "card_1",
    content: "",
    createdAt: 1,
    type: "document",
    updatedAt: 1,
    userId: "u1",
    ...overrides,
  }) as any;

describe("card/queryUtils.ts", () => {
  test("grid results omit raw provider payloads while preserving card data", async () => {
    const storedCard = card({
      content: "Customer content ".repeat(1000),
      notes: "Customer notes",
      tags: ["saved"],
      metadata: {
        linkPreview: {
          status: "success",
          title: "Preview title",
          description: "Preview description",
          raw: { scrape: "large scrape payload".repeat(1000) },
        },
        linkCategory: {
          category: "article",
          fetchedAt: 1,
          sourceUrl: "https://example.com",
          facts: [{ label: "Author", value: "Author name" }],
          raw: { provider: "large provider payload".repeat(1000) },
        },
      },
    });
    storedCard.workflowArtifactKeys = [
      "users/customer/card/workflow-artifacts/private.json",
    ];
    const original = structuredClone(storedCard);
    const [grid] = await attachGridFileUrls({}, [storedCard]);
    const [detail] = await attachFileUrls({}, [storedCard]);

    expect(grid?.metadata?.linkPreview).toStrictEqual({
      status: "success",
      title: "Preview title",
      description: "Preview description",
    });
    expect(grid?.metadata?.linkCategory).toStrictEqual({
      category: "article",
      fetchedAt: 1,
      sourceUrl: "https://example.com",
      facts: [{ label: "Author", value: "Author name" }],
    });
    expect(grid).not.toHaveProperty("workflowArtifactKeys");
    expect(detail).not.toHaveProperty("workflowArtifactKeys");
    expect(grid?.content).toBe(original.content);
    expect(grid?.notes).toBe(original.notes);
    expect(grid?.tags).toEqual(original.tags);
    expect(detail?.metadata).toEqual(original.metadata);
    expect(storedCard).toEqual(original);
    expect(JSON.stringify(grid).length).toBeLessThan(
      JSON.stringify(detail).length / 2
    );
  });

  test("grid results preserve absent metadata and preview-only metadata", async () => {
    const metadata = {
      linkPreview: { status: "success", title: "Preview title" },
    };
    const [withoutMetadata, preview] = await attachGridFileUrls({}, [
      card({}),
      card({ metadata }),
    ]);
    expect(withoutMetadata?.metadata).toBeUndefined();
    expect(preview?.metadata).toEqual(metadata);
  });

  test("skips out-of-namespace keys instead of failing hydration", async () => {
    process.env.FILES_BASE = "https://files.example.com";
    process.env.FILES_SIGNING_SECRET = "test-secret";
    process.env.R2_KEY_PREFIX = "dev/";

    const [legacy, canonical] = await attachFileUrls({} as any, [
      card({ _id: "legacy", fileKey: "users/abc/cards/file/old.png" }),
      card({ _id: "canon", fileKey: "dev/users/abc/cards/file/new.png" }),
    ]);

    expect(legacy?.fileUrl).toBeUndefined();
    expect(canonical?.fileUrl).toContain(
      "https://files.example.com/dev/users/abc/cards/file/new.png"
    );
  });
});
