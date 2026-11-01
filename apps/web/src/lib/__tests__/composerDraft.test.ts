import { describe, expect, test } from "bun:test";
import {
  composerDraftKey,
  readComposerDraft,
  storeComposerDraft,
} from "../composerDraft";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};

const brokenStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("composer draft", () => {
  test("keeps a draft per account and reads it back", () => {
    const storage = memoryStorage();
    expect(storeComposerDraft("user_a", "Half a thought", storage)).toBe(true);
    expect(storeComposerDraft("user_b", "Another account", storage)).toBe(true);
    expect(readComposerDraft("user_a", storage)).toBe("Half a thought");
    expect(readComposerDraft("user_b", storage)).toBe("Another account");
    expect(storage.values.get(composerDraftKey("user_a"))).toBe(
      "Half a thought"
    );
  });

  test("an emptied draft is cleared, not kept as blank text", () => {
    const storage = memoryStorage();
    storeComposerDraft("user_a", "Saved soon", storage);
    expect(storeComposerDraft("user_a", "  \n", storage)).toBe(true);
    expect(storage.values.has(composerDraftKey("user_a"))).toBe(false);
    expect(readComposerDraft("user_a", storage)).toBe("");
  });

  test("blocked or full storage reads empty and says the draft wasn't kept", () => {
    expect(readComposerDraft("user_a", brokenStorage)).toBe("");
    expect(storeComposerDraft("user_a", "Too big to keep", brokenStorage)).toBe(
      false
    );
    expect(storeComposerDraft("user_a", "No storage", null)).toBe(false);
    expect(readComposerDraft("user_a", null)).toBe("");
  });
});
