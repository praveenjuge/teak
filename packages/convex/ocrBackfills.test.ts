/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";

// The backfills that read the text in link images and scanned PDFs saved
// before Teak read them (roadmap v2 phase 11).

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type OpAnswer =
  | { data: unknown }
  | { error: string; status: number }
  | ((params: Record<string, any>) => { data: unknown });

/** Stubs the Files Worker: each op answers from `answers`, others with `{}`. */
const stubFilesWorker = (answers: Record<string, OpAnswer>) => {
  const calls: { op: string; params: Record<string, any> }[] = [];
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "ocr-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const { op, params } = JSON.parse(String(init?.body));
      calls.push({ op, params });
      const entry = answers[op] ?? { data: {} };
      const answer = typeof entry === "function" ? entry(params) : entry;
      if ("error" in answer) {
        return Response.json(
          {
            ok: false,
            version: 1,
            requestId: "r",
            error: {
              code: answer.error,
              message: answer.error,
              retryable: false,
            },
          },
          { status: answer.status }
        );
      }
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: answer.data,
      });
    })
  );
  return { calls, opsCalled: (op: string) => calls.filter((c) => c.op === op) };
};

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });
  let createdAt = 1000;
  const insert = (fields: Partial<Doc<"cards">> & Pick<Doc<"cards">, "type">) =>
    t.run(async (ctx) => {
      createdAt += 1;
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        content: "",
        createdAt,
        updatedAt: createdAt,
        ...fields,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const search = async (searchQuery: string) => {
    await runScheduled();
    const result = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery,
      paginationOpts: { numItems: 20, cursor: null },
    });
    return result.page.map((item: { content: string }) => item.content);
  };
  const turnAiOff = () =>
    t.run((ctx) =>
      ctx.db.insert("adminUserFlags", {
        teakUserId: "owner",
        internal: false,
        aiDisabled: true,
        updatedAt: 1,
      })
    );
  return { t, insert, card, runScheduled, search, turnAiOff };
};

describe("backfillLinkOcr", () => {
  const OG = "users/owner/cards/c/link-image/og.jpg";
  const SHOT = "users/owner/cards/c/screenshot/page.jpg";
  const link = (
    content: string,
    linkPreview: Record<string, unknown>,
    fields: Partial<Doc<"cards">> = {}
  ) => ({
    type: "link" as const,
    content,
    url: `https://example.com/${content.replaceAll(" ", "-")}`,
    metadata: {
      linkPreview: {
        source: "test",
        status: "success" as const,
        ...linkPreview,
      },
    },
    ...fields,
  });

  const seedLinks = (insert: Awaited<ReturnType<typeof setup>>["insert"]) =>
    Promise.all([
      insert(link("Talk", { imageStorageKey: OG, screenshotStorageKey: SHOT })),
      insert(link("Read", { screenshotStorageKey: SHOT }, { ocrCheckedAt: 5 })),
      insert(link("Broken", { status: "error" })),
      insert(
        link("Trashed", { screenshotStorageKey: SHOT }, { isDeleted: true })
      ),
      insert({ type: "text", content: "A note" }),
    ]);

  test("a dry run counts the links and writes nothing", async () => {
    const files = stubFilesWorker({});
    const { t, insert, card } = await setup();
    const [talk] = await seedLinks(insert);
    const result = await t.mutation(
      internal.migration.backfillLinkOcr.backfillLinkOcr,
      { batchSize: 50, once: true }
    );
    expect(result.batch).toEqual({
      examined: 5,
      alreadyRead: 1,
      noSource: 1,
      trashed: 1,
      queued: 1,
      skippedDeletingAccounts: 0,
      skippedAiDisabled: 0,
    });
    expect(files.calls).toEqual([]);
    expect((await card(talk))?.ocrCheckedAt).toBeUndefined();
  });

  test("a real run reads the preview image and the screenshot, then stops picking the card", async () => {
    const files = stubFilesWorker({
      "extract-image-text": (params) => ({
        data: {
          text:
            params.sourceKey === OG
              ? "SCALING POSTGRES"
              : "Talk notes and slides",
        },
      }),
    });
    const { t, insert, card, runScheduled, search } = await setup();
    const [talk] = await seedLinks(insert);
    await t.mutation(internal.migration.backfillLinkOcr.backfillLinkOcr, {
      dryRun: false,
      batchSize: 2,
    });
    await runScheduled();

    expect(
      files.opsCalled("extract-image-text").map((call) => call.params)
    ).toEqual([{ sourceKey: OG }, { sourceKey: SHOT }]);
    const read = await card(talk);
    expect(read?.aiOcrText).toBe("SCALING POSTGRES\n\nTalk notes and slides");
    expect(read?.ocrCheckedAt).toBeTypeOf("number");
    expect(await search('text:"scaling postgres"')).toEqual(["Talk"]);

    const again = await t.mutation(
      internal.migration.backfillLinkOcr.backfillLinkOcr,
      { batchSize: 50, once: true }
    );
    expect(again.batch).toMatchObject({ alreadyRead: 2, queued: 0 });
  });

  test("an image the Worker declines reads as none", async () => {
    stubFilesWorker({
      "extract-image-text": (params) =>
        params.sourceKey === OG
          ? ({ error: "UNSUPPORTED", status: 415 } as never)
          : { data: { text: "" } },
    });
    const { t, insert, card } = await setup();
    const [talk] = await seedLinks(insert);
    expect(
      await t.action(internal.migration.backfillLinkOcr.backfillLinkOcrCard, {
        cardId: talk,
      })
    ).toBe("empty");
    const read = await card(talk);
    expect(read?.aiOcrText).toBeUndefined();
    expect(read?.ocrCheckedAt).toBeTypeOf("number");
  });

  test("a Worker without the op leaves the card unread", async () => {
    stubFilesWorker({
      "extract-image-text": { error: "INVALID_INPUT", status: 400 },
    });
    const { t, insert, card } = await setup();
    const [talk] = await seedLinks(insert);
    expect(
      await t.action(internal.migration.backfillLinkOcr.backfillLinkOcrCard, {
        cardId: talk,
      })
    ).toBe("failed");
    expect((await card(talk))?.ocrCheckedAt).toBeUndefined();
  });

  test("a card processed again while its images were read keeps the newer run", async () => {
    const { t, insert, card } = await setup();
    const [talk] = await seedLinks(insert);
    const candidate = await t.query(
      internal.migration.backfillLinkOcr.getLinkOcrCandidate,
      { cardId: talk }
    );
    await t.run((ctx) => ctx.db.patch("cards", talk, { processingRev: 3 }));
    expect(
      await t.mutation(internal.migration.backfillLinkOcr.storeLinkOcr, {
        cardId: talk,
        processingRev: candidate?.processingRev,
        aiOcrText: "Old screenshot",
      })
    ).toBe(false);
    expect((await card(talk))?.aiOcrText).toBeUndefined();
  });

  test("never sends the images of an account with AI off", async () => {
    const files = stubFilesWorker({});
    const { t, insert, turnAiOff } = await setup();
    const [talk] = await seedLinks(insert);
    await turnAiOff();
    const result = await t.mutation(
      internal.migration.backfillLinkOcr.backfillLinkOcr,
      { batchSize: 50, once: true }
    );
    expect(result.batch).toMatchObject({ queued: 0, skippedAiDisabled: 1 });
    expect(
      await t.action(internal.migration.backfillLinkOcr.backfillLinkOcrCard, {
        cardId: talk,
      })
    ).toBe("skipped");
    expect(files.calls).toEqual([]);
  });
});

describe("backfillPdfOcr", () => {
  const pdf = (
    content: string,
    fields: Partial<Doc<"cards">> = {},
    fileName = `${content.replaceAll(" ", "-")}.pdf`
  ) => ({
    type: "document" as const,
    content,
    fileKey: `users/owner/cards/c/file/${fileName}`,
    fileMetadata: { fileName, fileSize: 1000, mimeType: "application/pdf" },
    ...fields,
  });

  /** inspect answers: a scan, a scan with a footer, and a text PDF. */
  const inspectAnswer = (params: Record<string, any>) => {
    const key = String(params.sourceKey);
    if (key.endsWith("lease.pdf")) {
      return { data: { facts: { pageCount: 3 }, text: "" } };
    }
    if (key.endsWith("footer.pdf")) {
      return {
        data: { facts: { pageCount: 2 }, text: "Scanned by OfficeScan" },
      };
    }
    return {
      data: {
        facts: { pageCount: 1 },
        text: "Kestrel Freight agreed to net 30 days on every invoice.",
      },
    };
  };

  const seedPdfs = (insert: Awaited<ReturnType<typeof setup>>["insert"]) =>
    Promise.all([
      insert(pdf("lease")),
      insert(pdf("footer")),
      insert(pdf("invoice")),
      insert(pdf("read", { ocrCheckedAt: 5 })),
      insert(pdf("trashed", { isDeleted: true })),
      insert(pdf("no file", { fileKey: undefined })),
      insert(pdf("notes", {}, "notes.docx")),
    ]);

  const dispatches = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
    t.run((ctx) => ctx.db.query("workflowDispatches").collect());

  test("a dry run counts the PDFs and writes nothing", async () => {
    const files = stubFilesWorker({});
    const { t, insert } = await setup();
    await seedPdfs(insert);
    const result = await t.mutation(
      internal.migration.backfillPdfOcr.backfillPdfOcr,
      { batchSize: 50, once: true }
    );
    expect(result.batch).toEqual({
      examined: 7,
      alreadyRead: 1,
      noSource: 1,
      trashed: 1,
      queued: 3,
      skippedDeletingAccounts: 0,
      skippedAiDisabled: 0,
    });
    expect(files.calls).toEqual([]);
  });

  test("a scan gets a metadata-only run, a text PDF is marked checked", async () => {
    const files = stubFilesWorker({ inspect: inspectAnswer });
    const { t, insert, card } = await setup();
    const [lease, footer, invoice] = await seedPdfs(insert);
    const outcomes: string[] = [];
    for (const cardId of [lease, footer, invoice]) {
      outcomes.push(
        await t.action(internal.migration.backfillPdfOcr.backfillPdfOcrCard, {
          cardId,
        })
      );
    }
    expect(outcomes).toEqual(["queued", "queued", "checked"]);
    expect(files.opsCalled("inspect")[0]?.params).toEqual({
      formatId: "pdf",
      maxBytes: 100 * 1024 * 1024,
      mode: "pdf",
      rtf: false,
      sourceKey: "users/owner/cards/c/file/lease.pdf",
    });
    expect(
      (await dispatches(t)).map((dispatch) => ({
        cardId: dispatch.cardId,
        metadataOnly: dispatch.params?.metadataOnly,
      }))
    ).toEqual([
      { cardId: lease, metadataOnly: true },
      { cardId: footer, metadataOnly: true },
    ]);
    // The run marks a scan read once its pages are; a text PDF is done now.
    expect((await card(lease))?.ocrCheckedAt).toBeUndefined();
    expect((await card(invoice))?.ocrCheckedAt).toBeTypeOf("number");
    expect((await card(invoice))?.processingRev).toBeUndefined();
  });

  test("a PDF the Worker declines is checked, not read", async () => {
    stubFilesWorker({ inspect: { error: "UNSUPPORTED", status: 415 } });
    const { t, insert, card } = await setup();
    const [lease] = await seedPdfs(insert);
    expect(
      await t.action(internal.migration.backfillPdfOcr.backfillPdfOcrCard, {
        cardId: lease,
      })
    ).toBe("checked");
    expect((await card(lease))?.ocrCheckedAt).toBeTypeOf("number");
    expect(await dispatches(t)).toEqual([]);
  });

  test("a busy renderer leaves the PDF unread for a rerun", async () => {
    stubFilesWorker({
      inspect: { error: "RENDERER_UNAVAILABLE", status: 503 },
    });
    const { t, insert, card } = await setup();
    const [lease] = await seedPdfs(insert);
    expect(
      await t.action(internal.migration.backfillPdfOcr.backfillPdfOcrCard, {
        cardId: lease,
      })
    ).toBe("failed");
    expect((await card(lease))?.ocrCheckedAt).toBeUndefined();
  });

  test("a PDF processed again while it was checked keeps the newer run", async () => {
    const { t, insert } = await setup();
    const [lease] = await seedPdfs(insert);
    await t.run((ctx) => ctx.db.patch("cards", lease, { processingRev: 2 }));
    expect(
      await t.mutation(internal.migration.backfillPdfOcr.finishPdfOcrCheck, {
        cardId: lease,
        scanned: true,
      })
    ).toBe(false);
    expect(await dispatches(t)).toEqual([]);
  });

  test("an account whose deletion started after scheduling gets no run", async () => {
    stubFilesWorker({ inspect: inspectAnswer });
    const { t, insert, card } = await setup();
    const [lease, , invoice] = await seedPdfs(insert);
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        startedAt: 1,
        stage: 3,
        generation: 1,
      })
    );
    for (const cardId of [lease, invoice]) {
      expect(
        await t.action(internal.migration.backfillPdfOcr.backfillPdfOcrCard, {
          cardId,
        })
      ).toBe("skipped");
    }
    expect(await dispatches(t)).toEqual([]);
    expect((await card(invoice))?.ocrCheckedAt).toBeUndefined();
  });

  test("AI off or paused: no PDF is checked or read", async () => {
    const files = stubFilesWorker({ inspect: inspectAnswer });
    const { t, insert, card, turnAiOff } = await setup();
    const [lease] = await seedPdfs(insert);
    await turnAiOff();
    const result = await t.mutation(
      internal.migration.backfillPdfOcr.backfillPdfOcr,
      { batchSize: 50, once: true }
    );
    expect(result.batch).toMatchObject({ queued: 0, skippedAiDisabled: 3 });
    expect(
      await t.action(internal.migration.backfillPdfOcr.backfillPdfOcrCard, {
        cardId: lease,
      })
    ).toBe("skipped");
    expect(files.calls).toEqual([]);
    expect((await card(lease))?.ocrCheckedAt).toBeUndefined();
  });

  test("skips accounts being deleted", async () => {
    const { t, insert } = await setup();
    await seedPdfs(insert);
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        startedAt: 1,
        stage: 3,
        generation: 1,
      })
    );
    const result = await t.mutation(
      internal.migration.backfillPdfOcr.backfillPdfOcr,
      { batchSize: 50, once: true }
    );
    expect(result.batch).toMatchObject({
      queued: 0,
      skippedDeletingAccounts: 3,
    });
  });
});
