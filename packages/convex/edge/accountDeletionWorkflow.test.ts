import betterAuthTest from "@convex-dev/better-auth/test";
import polarTest from "@convex-dev/polar/test";
import workosTest from "@convex-dev/workos-authkit/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  convexForWorker,
  loadFilesWorker,
} from "../__tests__/helpers/filesWorker.test-utils";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { buildR2UserPrefix } from "../storage/r2";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
const filesWorker = await loadFilesWorker();
const modules = import.meta.glob("../**/*.ts");
const claims = {
  issuer: "https://api.workos.com/user_management/client_DELETE",
  subject: "user_DELETE",
  sid: "session_DELETE",
  email_verified: true,
  external_id: "permanent-owner",
};
const fixture = async (legacy = false) => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  polarTest.register(t);
  apiKeysTest.register(t);
  workosTest.register(t);
  const legacyUser = legacy
    ? await t.mutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Disposable owner",
            email: "legacy@example.com",
            emailVerified: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      })
    : null;
  const ownerId = legacyUser?._id ?? "permanent-owner";
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      workosUserId: "user_DELETE",
      email: "legacy@example.com",
      emailVerified: true,
    })
  );
  await seedComponentUser(t, {
    id: "user_DELETE",
    email: "provider@example.com",
    externalId: ownerId,
  });
  const card = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: ownerId,
      content: "private",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    })
  );
  return {
    t,
    card,
    ownerId,
    signed: t.withIdentity({ ...claims, external_id: ownerId }),
  };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DELETE");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_DELETE");
  vi.stubEnv("WORKOS_API_KEY", "test-workos-account-deletion-key");
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("durable deletion admission and tombstones", () => {
  test("writer pages cancel bounded pages of jobs and refuse a replayed checkpoint", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(state!._id, { stage: 3 });
      for (let index = 0; index < 45; index++) {
        await ctx.db.insert("exportJobs", {
          userId: "permanent-owner",
          status: "ready",
          createdAt: index,
          updatedAt: index,
          ...(index === 0 ? { workflowId: "export-running" } : {}),
        });
      }
      await ctx.db.insert("exportJobs", {
        userId: "sibling",
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const binding = { stateId: state!._id, generation: 1 };
    type Table = "importJobs" | "exportJobs";
    const page = (table: Table, cursor: string | null) =>
      t.mutation(internal.accountDeletionData.cancelJobsPage, {
        ...binding,
        table,
        cursor,
      });
    const checkpoint = (
      table: Table,
      previous: string | null,
      next: string,
      done: boolean
    ) =>
      t.mutation(internal.accountDeletionData.checkpointWriters, {
        ...binding,
        table,
        previous,
        next,
        done,
      });
    const cancelled = async () =>
      (
        await t.run((ctx) =>
          ctx.db
            .query("exportJobs")
            .withIndex("by_user_created", (q) =>
              q.eq("userId", "permanent-owner")
            )
            .take(50)
        )
      ).filter((row) => row.cancelRequested).length;

    const imports = await page("importJobs", null);
    expect(imports).toMatchObject({ done: true, workflowIds: [] });
    await checkpoint("importJobs", null, imports.cursor, imports.done);
    const first = await page("exportJobs", null);
    expect(first.workflowIds).toEqual(["export-running"]);
    expect(await cancelled()).toBe(20);
    await checkpoint("exportJobs", null, first.cursor, first.done);
    await expect(
      checkpoint("exportJobs", null, first.cursor, first.done)
    ).rejects.toThrow("stale_deletion_writer_page");
    const second = await page("exportJobs", first.cursor);
    await checkpoint("exportJobs", first.cursor, second.cursor, second.done);
    expect(await cancelled()).toBe(40);
    const third = await page("exportJobs", second.cursor);
    expect(third.done).toBe(true);
    await checkpoint("exportJobs", second.cursor, third.cursor, third.done);
    expect(await cancelled()).toBe(45);
    expect(await t.run((ctx) => ctx.db.get(state!._id))).toMatchObject({
      writersPrepared: true,
    });
    await expect(
      t.mutation(internal.accountDeletionData.cancelJobsPage, {
        ...binding,
        generation: 2,
        table: "exportJobs",
        cursor: null,
      })
    ).rejects.toThrow("stale_deletion_generation");
    const sibling = await t.run((ctx) =>
      ctx.db
        .query("exportJobs")
        .withIndex("by_user_created", (q) => q.eq("userId", "sibling"))
        .unique()
    );
    expect(sibling?.cancelRequested).toBeUndefined();
  });
  test.each([1, 2])(
    "retired provider stage %s advances without calling WorkOS",
    async (stage) => {
      const { t, signed } = await fixture();
      await signed.mutation(api.accountDeletion.deleteMyAccount, {});
      const state = await t.run((ctx) =>
        ctx.db.query("accountDeletionStates").unique()
      );
      await t.run((ctx) => ctx.db.patch(state!._id, { stage }));
      const fetcher = vi.fn(() => Response.json({}));
      vi.stubGlobal("fetch", fetcher);
      expect(
        await t.action(internal.accountDeletionActions.runStage, {
          stateId: state!._id,
          generation: 1,
          stage,
        })
      ).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );
  test.each([
    "..",
    "user_../OTHER",
    "user_A%2F..",
    "https://attacker.invalid/",
  ])(
    "WorkOS user deletion rejects malformed user ID %s before network access",
    async (workosUserId) => {
      const { t, signed } = await fixture();
      await signed.mutation(api.accountDeletion.deleteMyAccount, {});
      const state = await t.run((ctx) =>
        ctx.db.query("accountDeletionStates").unique()
      );
      await t.run(async (ctx) => {
        const owner = await ctx.db.query("users").unique();
        await ctx.db.patch(owner!._id, { workosUserId });
        await ctx.db.patch(state!._id, { stage: 4, workosUserId });
      });
      const requests: string[] = [];
      vi.stubGlobal("fetch", (input: string | URL | Request) => {
        requests.push(input instanceof Request ? input.url : String(input));
        return Response.json({});
      });
      await expect(
        t.action(internal.accountDeletionActions.runStage, {
          stateId: state!._id,
          generation: 1,
          stage: 4,
        })
      ).rejects.toThrow("deletion_workos_user_id_invalid");
      expect(requests).toEqual([]);
      expect(await t.run((ctx) => ctx.db.get(state!._id))).toMatchObject({
        stage: 4,
        workosUserId,
      });
    }
  );
  test("a deletion already at account data resumes there and still deletes the WorkOS user", async () => {
    const { t, signed } = await fixture();
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "disposable-secret");
    const env = filesWorker.withObjectGates({
      BUCKET: new filesWorker.FakeBucket(),
      FILES_SIGNING_SECRET: "disposable-secret",
    });
    const providerRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        const method =
          options?.method ?? (input instanceof Request ? input.method : "GET");
        providerRequests.push(`${method} ${url.pathname}`);
        if (method === "DELETE" && url.pathname.endsWith("/user_DELETE")) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `unexpected_provider_request:${method}:${url.pathname}`
        );
      })
    );
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 3 }));
    await filesWorker.runAccountDeletion(
      {
        env,
        instanceId: state!.workflowId,
        params: {
          stateId: state!._id,
          generation: 1,
          convexSiteUrl: "https://session-tests.convex.site",
        },
        step: filesWorker.createFakeStep().step,
      },
      {
        convex: convexForWorker(t),
        ops: (spec: { op: string; params: Record<string, unknown> }) =>
          filesWorker.callFilesOp(env, spec),
      }
    );
    expect(providerRequests).toEqual([
      "DELETE /user_management/users/user_DELETE",
    ]);
    expect(await t.run((ctx) => ctx.db.query("cards").take(2))).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
      deletedAt: expect.any(Number),
    });
  });
  test("accepted request preserves owner, captures binding, denies access and schedules once", async () => {
    const { t, signed, card } = await fixture();
    expect(
      await signed.mutation(api.accountDeletion.deleteMyAccount, {})
    ).toBeNull();
    expect(await signed.query(api.cards.getCard, { id: card })).toBeNull();
    const first = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").take(2)
    );
    expect(first).toMatchObject([
      {
        userId: "permanent-owner",
        workosUserId: "user_DELETE",
        generation: 1,
        stage: 0,
        workosTarget: {
          clientId: "client_DELETE",
          environmentId: "environment_DELETE",
        },
      },
    ]);
    const runs = () =>
      t.run((ctx) => ctx.db.query("workflowDispatches").take(5));
    expect(await runs()).toMatchObject([
      {
        kind: "accountDeletion",
        instanceId: first[0]?.workflowId,
        params: { stateId: first[0]?._id, generation: 1 },
        state: "pending",
      },
    ]);
    expect(
      await signed.mutation(api.accountDeletion.deleteMyAccount, {})
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual(first);
    expect(await runs()).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
    });
  });
  test.each([
    { email_verified: false },
    { sid: "app_consent_WRONG" },
    { issuer: "https://convex.test" },
    { external_id: "another-owner" },
  ])("invalid proof cannot initiate deletion: %j", async (delta) => {
    const { t } = await fixture();
    await expect(
      t
        .withIdentity({ ...claims, ...delta })
        .mutation(api.accountDeletion.deleteMyAccount, {})
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual([]);
  });
  test("stale generation cannot advance or finish an accepted deletion", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await expect(
      t.mutation(internal.accountDeletionJobs.advance, {
        stateId: state!._id,
        generation: 2,
        stage: 0,
      })
    ).rejects.toThrow("stale");
    await expect(
      t.mutation(internal.accountDeletionJobs.finalize, {
        stateId: state!._id,
        generation: 1,
      })
    ).rejects.toThrow("stale");
    expect(await t.run((ctx) => ctx.db.get(state!._id))).toEqual(state);
  });
  test("finalization commits permanent tombstone before removing denial state", async () => {
    const { t, signed, card } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 6 }));
    await t.mutation(internal.accountDeletionJobs.finalize, {
      stateId: state!._id,
      generation: 1,
    });
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
      deletedAt: expect.any(Number),
    });
    expect(await signed.query(api.cards.getCard, { id: card })).toBeNull();
  });
  test("finalization keeps a WorkOS-created owner's address", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run(async (ctx) => {
      const owner = await ctx.db.query("users").first();
      await ctx.db.patch(owner!._id, { identityOrigin: "workos" });
      await ctx.db.patch(state!._id, { stage: 6 });
    });
    await t.mutation(internal.accountDeletionJobs.finalize, {
      stateId: state!._id,
      generation: 1,
    });
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      email: "legacy@example.com",
      emailVerified: true,
      deletedAt: expect.any(Number),
    });
  });
  test("storage evidence cannot be reassigned and deleting owner cannot register more keys", async () => {
    const { t, signed } = await fixture();
    const key = "users/collision/file";
    expect(
      await t.mutation(internal.storage.ownership.registerObject, {
        userId: "permanent-owner",
        key,
      })
    ).toBe(true);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "other-owner",
        email: "other@example.com",
        emailVerified: true,
      })
    );
    await expect(
      t.mutation(internal.storage.ownership.registerObject, {
        userId: "other-owner",
        key,
      })
    ).rejects.toThrow("owner_conflict");
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    expect(
      await t.mutation(internal.storage.ownership.registerObject, {
        userId: "permanent-owner",
        key: "users/collision/later",
      })
    ).toBe(false);
    expect(
      await t.query(internal.storage.ownership.getObjectsPage, {
        userId: "permanent-owner",
      })
    ).toMatchObject([{ key }]);
  });
  test("complete stages erase populated disposable data and delete the WorkOS user", async () => {
    const { t, signed, card } = await fixture();
    vi.stubEnv("WORKOS_API_KEY", "test-workos-account-deletion-key");
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "disposable-secret");
    const bucket = new filesWorker.FakeBucket();
    for (const key of [
      "users/exact/file",
      "users/exact/export.zip",
      "exports/exact/export-2.zip",
      "exports/exact/export-2.zip.checkpoint.json",
      "users/exact/unclaimed.pdf",
      "users/exact/document-text/digest.txt",
      "users/exact/linked.pdf",
      "users/exact/cards/k/page-archive/r1-archive.html",
      "users/exact/cards/upload-pending-v2/page-snapshot/s1",
      "users/exact/cards/k/article-text/digest.md",
      "users/exact/cards/k/article-image/digest.webp",
    ]) {
      bucket.objects.set(key, { bytes: new Uint8Array([1]) });
    }
    const env = filesWorker.withObjectGates({
      BUCKET: bucket,
      FILES_SIGNING_SECRET: "disposable-secret",
    });
    // Deleting the WorkOS user revokes its sessions and Connect grants, so
    // it is the only provider call a whole deletion makes.
    const providerRequests: string[] = [];
    const vectorDeletes: { ids: string[]; shard: number }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        const method =
          options?.method ?? (input instanceof Request ? input.method : "GET");
        providerRequests.push(`${method} ${url.pathname}`);
        if (method === "DELETE" && url.pathname.endsWith("/user_DELETE")) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `unexpected_provider_request:${method}:${url.pathname}`
        );
      })
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(card, {
        fileKey: "users/exact/file",
        documentTextKey: "users/exact/document-text/digest.txt",
        hasExtractedText: true,
        // The saved copy of a page, and a snapshot the extension sent.
        pageArchive: {
          bytes: 1,
          capturedAt: 1,
          kind: "full",
          source: "extension",
          sourceUrl: "https://example.com/private",
          storageKey: "users/exact/cards/k/page-archive/r1-archive.html",
        },
        pendingPageSnapshotAt: 1,
        pendingPageSnapshotKey:
          "users/exact/cards/upload-pending-v2/page-snapshot/s1",
        // The article in that copy, and an image it shows.
        article: {
          status: "ready",
          textKey: "users/exact/cards/k/article-text/digest.md",
          imageKeys: ["users/exact/cards/k/article-image/digest.webp"],
          wordCount: 300,
          readingMinutes: 1,
          extractedAt: 1,
        },
        tags: ["private"],
        folderIds: [],
      });
      const folderId = await ctx.db.insert("folders", {
        userId: "permanent-owner",
        name: "Private",
        nameKey: "private",
        kind: "manual",
        activeCardCount: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(card, { folderIds: [folderId] });
      await ctx.db.insert("folderCardCounts", {
        folderId,
        userId: "permanent-owner",
        shard: 0,
        count: 1,
      });
      await ctx.db.insert("folders", {
        userId: "permanent-owner",
        name: "Smart",
        nameKey: "smart",
        kind: "smart",
        query: "tag:private",
        activeCardCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("folderCards", {
        folderId,
        cardId: card,
        userId: "permanent-owner",
        type: "text",
        cardCreatedAt: 1,
        addedAt: 1,
      });
      await ctx.db.insert("cardSearchDocuments", {
        cardId: card,
        userId: "permanent-owner",
        searchableText: "private",
        type: "text",
        sourceUpdatedAt: 1,
        cardCreatedAt: 1,
        cardCreationTime: 1,
      });
      await ctx.db.insert("cardSearchTags", {
        cardId: card,
        userId: "permanent-owner",
        tag: "private",
        type: "text",
        cardCreatedAt: 1,
        sourceUpdatedAt: 1,
        syncGeneration: 1,
      });
      await ctx.db.insert("cardTextContents", {
        cardId: card,
        userId: "permanent-owner",
        kind: "document",
        text: "private",
        sourceKey: "users/exact/document-text/digest.txt",
        charCount: 7,
        truncated: false,
      });
      await ctx.db.insert("cardTextContents", {
        cardId: card,
        userId: "permanent-owner",
        kind: "article",
        text: "private article",
        sourceKey: "users/exact/cards/k/article-text/digest.md",
        charCount: 15,
        truncated: false,
      });
      await ctx.db.insert("linkedPdfs", {
        userId: "permanent-owner",
        sourceCardId: card,
        pdfUrl: "https://arxiv.org/pdf/1706.03762",
        status: "pending",
        fileKey: "users/exact/linked.pdf",
        claimToken: "claim",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("accountStorageObjects", {
        userId: "permanent-owner",
        key: "users/exact/linked.pdf",
      });
      await ctx.db.insert("cardLinks", {
        userId: "permanent-owner",
        fromCardId: card,
        toCardId: card,
        createdAt: 1,
      });
      await ctx.db.insert("linkChecks", {
        userId: "permanent-owner",
        cardId: card,
        outcome: "dead",
        httpStatus: 404,
        reason: "http_404",
        checkedAt: 1,
      });
      await ctx.db.insert("userPreferences", {
        userId: "permanent-owner",
        locale: "de",
        updatedAt: 1,
      });
      // More pages of pasted link jobs than of any other table, so the stage
      // keeps paging for these rows alone.
      for (let index = 0; index < 230; index += 1) {
        await ctx.db.insert("linkPasteJobs", {
          userId: "permanent-owner",
          urls: [`https://example.com/pasted/${index}`],
          total: 1,
          omittedOverLimit: 0,
          omittedRepeats: 0,
          omittedUnsafe: 0,
          nextIndex: 1,
          created: 1,
          resaved: 0,
          failed: 0,
          attempts: 0,
          status: index === 0 ? "running" : "done",
          createdAt: 1,
          updatedAt: 1,
          ...(index === 0 ? {} : { finishedAt: 1 }),
        });
      }
      await ctx.db.insert("userTagSummaries", {
        userId: "permanent-owner",
        items: [{ name: "private", count: 1 }],
        isComplete: true,
        computedAt: 1,
      });
      await ctx.db.insert("tagSummaryRefreshes", {
        userId: "permanent-owner",
        dueAt: 1,
      });
      await ctx.db.insert("userTagCounts", {
        userId: "permanent-owner",
        tag: "private",
        count: 1,
      });
      await ctx.db.insert("tagCountDeltas", {
        userId: "permanent-owner",
        tag: "private",
        delta: 1,
      });
      await ctx.db.insert("tagOperations", {
        userId: "permanent-owner",
        kind: "rename",
        from: "secret",
        to: "private",
        status: "completed",
        total: 1,
        processed: 1,
        changed: 1,
        createdAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      await ctx.db.insert("exportJobs", {
        userId: "permanent-owner",
        status: "ready",
        artifactKey: "users/exact/export.zip",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("exportJobs", {
        userId: "permanent-owner",
        status: "ready",
        artifactKey: "exports/exact/export-2.zip",
        createdAt: 2,
        updatedAt: 2,
      });
      const jobId = await ctx.db.insert("importJobs", {
        userId: "permanent-owner",
        mode: "archive",
        status: "failed",
        phase: "complete",
        fileName: "archive.zip",
        fileSize: 1,
        fileLastModified: 1,
        sourceKey: "users/exact/source.zip",
        parsedCount: 1,
        processedCount: 1,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 1,
        createdAt: 1,
        updatedAt: 1,
        stagedItems: { pages: 1, parts: 2, cursor: 1, part: 1, offset: 0 },
      });
      for (const part of [1, 2]) {
        bucket.objects.set(
          `${buildR2UserPrefix("permanent-owner")}/imports/${jobId}/staged/${part}.json`,
          { bytes: new Uint8Array([1]) }
        );
      }
      await ctx.db.insert("importJobItems", {
        userId: "permanent-owner",
        jobId,
        sourceIndex: 0,
        status: "failed",
        type: "document",
        content: "private",
        extractedFileKey: "users/exact/unclaimed.pdf",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("vectorShards", {
        userId: "permanent-owner",
        shard: 0,
      });
      await ctx.db.insert("cardEmbeddings", {
        cardId: card,
        userId: "permanent-owner",
        shard: 0,
        namespace: "permanent-owner",
        hash: "a".repeat(64),
        embeddedAt: 1,
      });
      await ctx.db.insert("semanticSearchResults", {
        userId: "permanent-owner",
        key: "b".repeat(64),
        ranking: [{ cardId: card, score: 0.5 }],
        createdAt: 1,
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("searchRelevanceResults", {
        userId: "permanent-owner",
        key: "c".repeat(64),
        scores: [{ cardId: card, score: 2, cardUpdatedAt: 1 }],
        createdAt: 1,
        expiresAt: Date.now() + 60_000,
      });
    });
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    const binding = { stateId: state!._id, generation: 1 };
    await filesWorker.runAccountDeletion(
      {
        env,
        instanceId: state!.workflowId,
        params: {
          ...binding,
          convexSiteUrl: "https://session-tests.convex.site",
        },
        step: filesWorker.createFakeStep().step,
      },
      {
        convex: convexForWorker(t),
        ops: (spec: { op: string; params: Record<string, unknown> }) => {
          if (spec.op === "vector-delete") {
            vectorDeletes.push(spec.params as { ids: string[]; shard: number });
            return Promise.resolve({ kind: "ok", data: { mutationId: "m" } });
          }
          return filesWorker.callFilesOp(env, spec);
        },
      }
    );
    expect(
      await t.run((ctx) => ctx.db.query("workflowDispatches").take(2))
    ).toMatchObject([{ instanceId: state!.workflowId, state: "done" }]);
    expect(providerRequests).toEqual([
      "DELETE /user_management/users/user_DELETE",
    ]);
    expect(bucket.objects.size).toBe(0);
    expect(vectorDeletes).toEqual([{ ids: [card], shard: 0 }]);
    expect(await t.run((ctx) => ctx.db.query("cards").take(2))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("exportJobs").take(2))).toEqual(
      []
    );
    expect(
      await t.run((ctx) => ctx.db.query("importJobItems").take(2))
    ).toEqual([]);
    for (const table of [
      "folders",
      "folderCards",
      "cardSearchDocuments",
      "cardSearchTags",
      "cardTextContents",
      "linkedPdfs",
      "cardLinks",
      "linkChecks",
      "linkPasteJobs",
      "userPreferences",
      "userTagSummaries",
      "tagSummaryRefreshes",
      "userTagCounts",
      "tagCountDeltas",
      "folderCardCounts",
      "tagOperations",
      "vectorShards",
      "cardEmbeddings",
      "semanticSearchResults",
      "searchRelevanceResults",
    ] as const) {
      expect({
        table,
        rows: await t.run((ctx) => ctx.db.query(table).take(2)),
      }).toEqual({ table, rows: [] });
    }
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
      deletedAt: expect.any(Number),
    });
  });
});

describe("billing closure", () => {
  const runFirstStage = async (
    t: Awaited<ReturnType<typeof fixture>>["t"],
    binding: { stateId: Id<"accountDeletionStates">; generation: number }
  ) => {
    let done = false;
    while (!done) {
      done = await t.action(internal.accountDeletionActions.runStage, {
        ...binding,
        stage: 0,
      });
    }
  };
  const polarDeletes: string[] = [];
  const stubPolar = (status: number) => {
    polarDeletes.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request?.url ?? String(input));
        const method = options?.method ?? request?.method ?? "GET";
        if (url.hostname !== "sandbox-api.polar.sh") {
          throw new Error(`unexpected_request:${method}:${url.pathname}`);
        }
        polarDeletes.push(`${method} ${url.pathname}${url.search}`);
        return status === 204
          ? new Response(null, { status })
          : Response.json(
              { error: "ResourceNotFound", detail: "Not found" },
              { status }
            );
      })
    );
  };
  const startDeletion = async (withCustomer: boolean) => {
    const { t, signed, ownerId } = await fixture();
    vi.stubEnv("POLAR_ACCESS_TOKEN", "test-polar-token");
    vi.stubEnv("POLAR_SERVER", "sandbox");
    if (withCustomer) {
      await t.mutation(components.polar.lib.insertCustomer, {
        id: "cust_DELETE",
        userId: ownerId,
      });
    }
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    return { t, binding: { stateId: state!._id, generation: 1 } };
  };

  test.each([204, 404])(
    "cancels and anonymizes the owner's Polar customer (Polar answers %i)",
    async (status) => {
      stubPolar(status);
      const { t, binding } = await startDeletion(true);
      await runFirstStage(t, binding);
      expect(polarDeletes).toEqual([
        "DELETE /v1/customers/cust_DELETE?anonymize=true",
      ]);
    }
  );

  test("an owner who never checked out makes no billing call", async () => {
    stubPolar(204);
    const { t, binding } = await startDeletion(false);
    await runFirstStage(t, binding);
    expect(polarDeletes).toEqual([]);
  });

  test("a Polar failure keeps the stage open for a retry", async () => {
    stubPolar(500);
    const { t, binding } = await startDeletion(true);
    await expect(runFirstStage(t, binding)).rejects.toThrow();
  });
});

test("local consent cleanup yields and resumes atomically across action retries", async () => {
  const { t, signed } = await fixture();
  await t.run(async (ctx) => {
    for (let n = 0; n < 250; n++) {
      await ctx.db.insert("workosConsents", {
        consentId: `app_consent_DELETE${n}`,
        userId: "permanent-owner",
        workosUserId: "user_DELETE",
        clientId: "client_test",
        firstSeenAt: n,
        lastSeenAt: n,
      });
    }
    await ctx.db.insert("workosConsents", {
      consentId: "app_consent_OTHER",
      userId: "other-owner",
      workosUserId: "user_OTHER",
      clientId: "client_test",
      firstSeenAt: 0,
      lastSeenAt: 0,
    });
  });
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  if (!state) {
    throw new Error("Missing deletion state");
  }
  const binding = { stateId: state._id, generation: 1, stage: 0 };
  const revoked = () =>
    t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("workosConsents")
            .withIndex("by_userId_and_firstSeenAt", (q) =>
              q.eq("userId", "permanent-owner")
            )
            .take(251)
        ).filter((row) => row.revokedAt !== undefined).length
    );
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(false);
  expect(await revoked()).toBe(100);
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(false);
  expect(await revoked()).toBe(200);
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(true);
  expect(await revoked()).toBe(250);
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(true);
  expect(await revoked()).toBe(250);
  await expect(
    t.action(internal.accountDeletionActions.runStage, {
      ...binding,
      generation: 2,
    })
  ).rejects.toThrow("stale_deletion_generation");
  const sibling = await t.run((ctx) =>
    ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", "app_consent_OTHER"))
      .unique()
  );
  expect(sibling?.revokedAt).toBeUndefined();
});

test("legacy deletion removes every retained Better Auth row and redacts the owner", async () => {
  const { t, signed, ownerId } = await fixture(true);
  const seed = (model: string, data: Record<string, unknown>) =>
    t.mutation(components.betterAuth.adapter.create, {
      input: { model, data },
    } as never);
  const sibling = (await seed("user", {
    name: "Sibling",
    email: "sibling@example.com",
    emailVerified: true,
    createdAt: 1,
    updatedAt: 1,
  })) as { _id: string };
  for (const userId of [ownerId, sibling._id]) {
    await seed("session", {
      userId,
      token: `token-${userId}`,
      expiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
    });
    await seed("account", {
      userId,
      accountId: userId,
      providerId: "credential",
      createdAt: 1,
      updatedAt: 1,
    });
    await seed("oauthAccessToken", {
      accessToken: `access-${userId}`,
      clientId: "teak-cli",
      userId,
    });
    await seed("oauthConsent", { clientId: "teak-cli", userId });
    await seed("twoFactor", { secret: "s", backupCodes: "b", userId });
  }
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  expect(state?.betterAuthUserId).toBe(ownerId);
  await t.run((ctx) => ctx.db.patch(state!._id, { stage: 5 }));
  expect(
    await t.action(internal.accountDeletionActions.runStage, {
      stateId: state!._id,
      generation: 1,
      stage: 5,
    })
  ).toBe(true);
  for (const model of [
    "session",
    "account",
    "oauthAccessToken",
    "oauthConsent",
    "twoFactor",
  ]) {
    const remaining = (await t.query(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: { cursor: null, numItems: 10 },
    } as never)) as { page: { userId: string }[] };
    expect(remaining.page.map((row) => row.userId)).toEqual([sibling._id]);
  }
  const users = (await t.query(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { cursor: null, numItems: 10 },
  } as never)) as { page: { _id: string }[] };
  expect(users.page.map((row) => row._id)).toEqual([sibling._id]);
  await t.run((ctx) => ctx.db.patch(state!._id, { stage: 6 }));
  await t.mutation(internal.accountDeletionJobs.finalize, {
    stateId: state!._id,
    generation: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("users").take(2))).toEqual([
    expect.objectContaining({
      teakUserId: ownerId,
      email: "",
      emailVerified: false,
      deletedAt: expect.any(Number),
    }),
  ]);
});

describe("analytics deletion", () => {
  const startFinalStage = async () => {
    const { t, signed, ownerId } = await fixture();
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("POSTHOG_PERSON_DELETION_API_KEY", "test-posthog-deletion-key");
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 5 }));
    return { t, ownerId, binding: { stateId: state!._id, generation: 1 } };
  };
  const stubPostHog = (status: number) => {
    const deletedDistinctIds: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.hostname !== "us.posthog.com") {
          throw new Error(`unexpected_request:${url.pathname}`);
        }
        if (status !== 202) {
          return new Response(null, { status });
        }
        const body = JSON.parse(options!.body as string) as {
          distinct_ids: string[];
        };
        deletedDistinctIds.push(...body.distinct_ids);
        return Response.json(
          { persons_found: 1, deletion_errors: [] },
          { status: 202 }
        );
      })
    );
    return deletedDistinctIds;
  };

  test("the final stage deletes the owner's PostHog person", async () => {
    const deletedDistinctIds = stubPostHog(202);
    const { t, ownerId, binding } = await startFinalStage();
    expect(
      await t.action(internal.accountDeletionActions.runStage, {
        ...binding,
        stage: 5,
      })
    ).toBe(true);
    expect(deletedDistinctIds).toEqual([ownerId]);
  });

  test("a PostHog outage keeps the final stage open and records why", async () => {
    stubPostHog(503);
    const { t, binding } = await startFinalStage();
    await expect(
      t.action(internal.accountDeletionActions.runStage, {
        ...binding,
        stage: 5,
      })
    ).rejects.toThrow("deletion_posthog_status_503");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await t.mutation(internal.accountDeletionJobs.recordFailure, {
      ...binding,
      stage: 5,
      reason: "analytics_deletion_failed",
    });
    const state = await t.run((ctx) => ctx.db.get(binding.stateId));
    expect(state).toMatchObject({
      stage: 5,
      failureCode: "account_deletion_stage_5_analytics_deletion_failed",
    });
    expect(state?.nextAttemptAt).toBeGreaterThan(Date.now());
  });
});
