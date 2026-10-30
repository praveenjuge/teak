import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../lib";
import { createMemoryBucket } from "../../test/cardProcessingKit";
import { hydrateArchivedMetadata, rawMetadataKey } from "./rawMetadata";

const CARD = { _id: "k57card1", userId: "user_1" };

const archived = async (raw: unknown, keyPrefix = "") => {
  const json = JSON.stringify(raw);
  const digest = await sha256Hex(json);
  const key = rawMetadataKey(keyPrefix, CARD, "linkPreview", digest);
  const memory = createMemoryBucket();
  memory.objects.set(key, json);
  return { digest, env: { BUCKET: memory.bucket }, json, key, memory };
};

describe("hydrateArchivedMetadata", () => {
  test("reads an archived raw preview back from R2", async () => {
    const raw = [{ results: [{ text: "Hi" }], selector: "title" }];
    const { digest, env, key } = await archived(raw);
    const card = {
      ...CARD,
      metadata: {
        linkPreview: {
          rawSha256: digest,
          rawStorageKey: key,
          status: "success",
        },
      },
    };
    const hydrated = await hydrateArchivedMetadata(env, "", card);
    expect(hydrated.metadata.linkPreview).toMatchObject({
      raw,
      status: "success",
    });
  });

  test("leaves inline raw metadata alone", async () => {
    const card = { ...CARD, metadata: { linkPreview: { raw: [1] } } };
    expect(
      await hydrateArchivedMetadata(
        { BUCKET: createMemoryBucket().bucket },
        "",
        card
      )
    ).toEqual(card);
  });

  test("refuses an object whose content does not match its digest", async () => {
    const { digest, env, key, memory } = await archived({ title: "real" });
    memory.objects.set(key, JSON.stringify({ title: "tampered" }));
    await expect(
      hydrateArchivedMetadata(env, "", {
        ...CARD,
        metadata: { linkPreview: { rawSha256: digest, rawStorageKey: key } },
      })
    ).rejects.toThrow("raw_metadata_hash_mismatch");
  });

  test("refuses a key outside the card's own namespace", async () => {
    const { digest, env } = await archived({ title: "x" });
    await expect(
      hydrateArchivedMetadata(env, "", {
        ...CARD,
        metadata: {
          linkPreview: {
            rawSha256: digest,
            rawStorageKey: `users/other/cards/k57card1/raw-linkPreview/${digest}.json`,
          },
        },
      })
    ).rejects.toThrow("raw_metadata_card_namespace_mismatch");
  });

  test("reads the development deployment's prefixed keys", async () => {
    const { digest, env, key } = await archived({ title: "dev" }, "dev/");
    expect(key.startsWith("dev/users/")).toBe(true);
    const hydrated = await hydrateArchivedMetadata(env, "dev/", {
      ...CARD,
      metadata: { linkPreview: { rawSha256: digest, rawStorageKey: key } },
    });
    expect(hydrated.metadata.linkPreview.raw).toEqual({ title: "dev" });
  });
});
