import { afterEach, describe, expect, test } from "bun:test";
import { attachFileUrls } from "../../card/queryUtils";

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
