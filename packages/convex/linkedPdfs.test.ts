import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "./__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { FREE_TIER_LIMIT } from "./shared/constants";

const modules = import.meta.glob("./**/*.ts");
const PAPER = "https://arxiv.org/abs/1706.03762";
const PDF = "https://arxiv.org/pdf/1706.03762";

interface WorkerCall {
  op: string;
  params: Record<string, unknown>;
}

type StoreAnswer =
  | { contentType: string; reused: boolean; size: number; stored: true }
  | { reason: string; stored: false };

const STORED: StoreAnswer = {
  contentType: "application/pdf",
  reused: false,
  size: 2048,
  stored: true,
};

const stubWorker = (
  answer: (call: WorkerCall) => StoreAnswer | Promise<StoreAnswer> = () =>
    STORED
) => {
  const calls: WorkerCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as WorkerCall;
      calls.push({ op: body.op, params: body.params });
      const data =
        body.op === "store-linked-pdf"
          ? await answer(body)
          : { mutationId: "m" };
      return Response.json({ ok: true, version: 1, requestId: "r", data });
    })
  );
  return calls;
};

const pdfCalls = (calls: WorkerCall[]) =>
  calls.filter((call) => call.op === "store-linked-pdf");

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: ownerWorkosId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });

  const paper = (
    fields: Partial<Doc<"cards">> = {},
    { pdfUrl = PDF, url = PAPER }: { pdfUrl?: string | null; url?: string } = {}
  ) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: url,
        url,
        metadata: {
          linkCategory: {
            category: "research",
            fetchedAt: 1,
            sourceUrl: url,
            ...(pdfUrl ? { pdfUrl } : {}),
          },
          linkPreview: { status: "success", title: "A paper" },
        },
        createdAt: 1,
        updatedAt: 1,
        ...fields,
      })
    );

  const save = (cardId: string, userId = "owner") =>
    t.action(internal.card.saveLinkedPdf.saveLinkedPdfForUser, {
      cardId,
      userId,
    });
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const rows = () => t.run((ctx) => ctx.db.query("linkedPdfs").collect());
  const fillToLimit = () =>
    t.run((ctx) =>
      ctx.db.insert("userCardUsage", {
        userId: "owner",
        activeCardCount: FREE_TIER_LIMIT,
        isCountExact: true,
        isSaturated: true,
        updatedAt: Date.now(),
      })
    );
  const trashThenDelete = async (cardId: Id<"cards">) => {
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, { isDeleted: true, deletedAt: 1 })
    );
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      cardId,
      userId: "owner",
    });
  };

  return { t, owner, paper, save, card, rows, fillToLimit, trashThenDelete };
};

const refusal = (code: string) => ({ data: expect.objectContaining({ code }) });

describe("Save PDF", () => {
  test("stores the paper's PDF as a new document card", async () => {
    const calls = stubWorker();
    const { paper, save, card, rows } = await setup();
    const link = await paper();

    const saved = await save(link);

    expect(saved.created).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({
      cardId: saved.cardId,
      pdfUrl: PDF,
      sourceCardId: link,
      status: "done",
    });
    expect(pdfCalls(calls)).toEqual([
      {
        op: "store-linked-pdf",
        params: { destinationKey: row?.fileKey, url: PDF },
      },
    ]);
    expect(await card(saved.cardId)).toMatchObject({
      fileKey: row?.fileKey,
      fileMetadata: expect.objectContaining({
        fileName: "1706.03762.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      }),
      type: "document",
      userId: "owner",
    });
  });

  test("saving again returns the same document without downloading", async () => {
    const calls = stubWorker();
    const { paper, save } = await setup();
    const link = await paper();

    const first = await save(link);
    const again = await save(link);

    expect(again).toEqual({ cardId: first.cardId, created: false });
    expect(pdfCalls(calls)).toHaveLength(1);
  });

  test("the dialog's action saves for the signed-in owner", async () => {
    stubWorker();
    const { owner, paper } = await setup();
    const link = await paper();

    const saved = await owner.action(api.card.saveLinkedPdf.saveLinkedPdf, {
      cardId: link,
    });

    expect(saved.created).toBe(true);
  });

  test("another user's card is not found", async () => {
    const calls = stubWorker();
    const { paper, save } = await setup();
    const link = await paper();

    await expect(save(link, "stranger")).rejects.toMatchObject(
      refusal("NOT_FOUND")
    );
    await expect(save("not-a-card-id")).rejects.toMatchObject(
      refusal("NOT_FOUND")
    );
    expect(calls).toEqual([]);
  });

  test("a card without an arXiv PDF has nothing to save", async () => {
    stubWorker();
    const { paper, save } = await setup();

    await expect(save(await paper({}, { pdfUrl: null }))).rejects.toMatchObject(
      refusal("INVALID_INPUT")
    );
    await expect(
      save(await paper({}, { pdfUrl: "https://evil.example/pdf/1706.03762" }))
    ).rejects.toMatchObject(refusal("INVALID_INPUT"));
    await expect(save(await paper({ type: "text" }))).rejects.toMatchObject(
      refusal("INVALID_INPUT")
    );
  });

  test("a card in Trash is refused", async () => {
    stubWorker();
    const { paper, save } = await setup();

    await expect(
      save(await paper({ isDeleted: true, deletedAt: 1 }))
    ).rejects.toMatchObject(refusal("CONFLICT"));
  });

  test("a link to the PDF itself makes a document, never returns the link", async () => {
    stubWorker();
    const { paper, save, card } = await setup();
    const link = await paper({}, { url: PDF });

    const saved = await save(link);

    expect(saved.cardId).not.toBe(link);
    expect((await card(saved.cardId))?.type).toBe("document");
  });

  test("two saves at once make one document", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubWorker(async () => {
      await gate;
      return STORED;
    });
    const { paper, save, t } = await setup();
    const link = await paper();

    const first = save(link);
    await vi.waitFor(() => expect(pdfCalls(calls)).toHaveLength(1));
    await expect(save(link)).rejects.toMatchObject(refusal("IN_PROGRESS"));
    release();
    const saved = await first;

    expect(await save(link)).toEqual({
      cardId: saved.cardId,
      created: false,
    });
    const documents = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .filter((q) => q.eq(q.field("type"), "document"))
        .collect()
    );
    expect(documents).toHaveLength(1);
  });

  test("a save interrupted after its claim reuses the same object later", async () => {
    vi.useFakeTimers();
    const calls = stubWorker();
    const { paper, save, t } = await setup();
    const link = await paper();
    const claim = await t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
      cardId: link,
      userId: "owner",
    });

    await expect(save(link)).rejects.toMatchObject(refusal("IN_PROGRESS"));
    vi.advanceTimersByTime(3 * 60 * 1000);
    const saved = await save(link);

    expect(saved.created).toBe(true);
    expect(pdfCalls(calls)[0]?.params.destinationKey).toBe(claim.fileKey);
  });

  test("a save interrupted after making its card returns that card", async () => {
    const calls = stubWorker();
    const { paper, save, t } = await setup();
    const link = await paper();
    const claim = await t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
      cardId: link,
      userId: "owner",
    });
    const made = await t.mutation(internal.card.linkedPdfs.completeLinkedPdf, {
      claimToken: claim.claimToken,
      fileSize: 10,
      linkedPdfId: claim.linkedPdfId,
      source: "api",
      storedMimeType: "application/pdf",
      userId: "owner",
    });
    expect(
      await t.mutation(internal.card.linkedPdfs.completeLinkedPdf, {
        claimToken: claim.claimToken,
        fileSize: 10,
        linkedPdfId: claim.linkedPdfId,
        source: "api",
        storedMimeType: "application/pdf",
        userId: "owner",
      })
    ).toEqual({ cardId: made.cardId, created: false });

    expect(await save(link)).toEqual({ cardId: made.cardId, created: false });
    expect(pdfCalls(calls)).toEqual([]);
  });

  test.each([
    ["unsupported_type", "UNSUPPORTED_TYPE"],
    ["too_large", "FILE_TOO_LARGE"],
    ["http_error", "SERVICE_UNAVAILABLE"],
    ["fetch_failed", "SERVICE_UNAVAILABLE"],
  ])(
    "a %s download fails as %s, and a retry tries again",
    async (reason, code) => {
      const calls = stubWorker(() => ({ reason, stored: false }));
      const { paper, save, rows } = await setup();
      const link = await paper();

      await expect(save(link)).rejects.toMatchObject(refusal(code));
      await expect(save(link)).rejects.toMatchObject(refusal(code));

      expect(pdfCalls(calls)).toHaveLength(2);
      expect((await rows())[0]?.status).toBe("failed");
    }
  );

  test("over the card limit, and again right away, is the limit", async () => {
    const calls = stubWorker();
    const { paper, save, fillToLimit, rows } = await setup();
    const link = await paper();
    await fillToLimit();

    await expect(save(link)).rejects.toMatchObject(
      refusal("CARD_LIMIT_REACHED")
    );
    await expect(save(link)).rejects.toMatchObject(
      refusal("CARD_LIMIT_REACHED")
    );
    expect(pdfCalls(calls)).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test("a document deleted for good can be saved again", async () => {
    stubWorker();
    const { paper, save, rows, trashThenDelete } = await setup();
    const link = await paper();
    const first = await save(link);

    await trashThenDelete(first.cardId);

    expect(await rows()).toEqual([]);
    const second = await save(link);
    expect(second.created).toBe(true);
    expect(second.cardId).not.toBe(first.cardId);
  });

  test("Trash cleanup clears a deleted document's row too", async () => {
    stubWorker();
    const { paper, save, rows, t } = await setup();
    const link = await paper();
    const first = await save(link);
    await t.run((ctx) =>
      ctx.db.patch("cards", first.cardId, { isDeleted: true, deletedAt: 1 })
    );

    await t.mutation(internal["card/trashCleanup"].cleanupDeletedCard, {
      cardId: first.cardId,
      cutoff: Date.now(),
    });

    expect(await rows()).toEqual([]);
    expect((await save(link)).created).toBe(true);
  });

  test("deleting the link for good drops its row and an unused PDF", async () => {
    const { paper, rows, t, trashThenDelete } = await setup();
    const link = await paper();
    const claim = await t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
      cardId: link,
      userId: "owner",
    });

    await trashThenDelete(link);

    expect(await rows()).toEqual([]);
    expect(await queuedObjectDeletions(t)).toContain(claim.fileKey);
  });

  test("deleting the link mid-download drops the PDF that lands after", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubWorker(async () => {
      await gate;
      return STORED;
    });
    const { paper, save, rows, t, trashThenDelete } = await setup();
    const link = await paper();

    const saving = save(link);
    await vi.waitFor(() => expect(pdfCalls(calls)).toHaveLength(1));
    const fileKey = pdfCalls(calls)[0]?.params.destinationKey;
    await trashThenDelete(link);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workflowDispatches").collect()) {
        await ctx.db.delete("workflowDispatches", row._id);
      }
    });
    release();

    await expect(saving).rejects.toMatchObject(refusal("NOT_FOUND"));
    expect(await rows()).toEqual([]);
    expect(await queuedObjectDeletions(t)).toContain(fileKey);
  });

  test("a document in Trash isn't saved: saving again makes a new one", async () => {
    stubWorker();
    const { paper, save, rows, t } = await setup();
    const link = await paper();
    const first = await save(link);
    const firstKey = (await rows())[0]?.fileKey;
    await t.run((ctx) =>
      ctx.db.patch("cards", first.cardId, { isDeleted: true, deletedAt: 1 })
    );

    const second = await save(link);

    expect(second.created).toBe(true);
    expect(second.cardId).not.toBe(first.cardId);
    const secondKey = (await rows())[0]?.fileKey;
    expect(secondKey).not.toBe(firstKey);
    expect(
      (await t.run((ctx) => ctx.db.get("cards", second.cardId)))?.fileKey
    ).toBe(secondKey);
  });

  test("a save slower than two minutes still holds its claim", async () => {
    vi.useFakeTimers();
    stubWorker();
    const { paper, save, t } = await setup();
    const link = await paper();
    await t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
      cardId: link,
      userId: "owner",
    });

    vi.advanceTimersByTime(150 * 1000);

    await expect(save(link)).rejects.toMatchObject(refusal("IN_PROGRESS"));
  });

  test("a link whose paper changed drops the PDF stored for the old one", async () => {
    const { paper, t } = await setup();
    const link = await paper();
    const claim = (cardId: Id<"cards">) =>
      t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
        cardId,
        userId: "owner",
      });
    const old = await claim(link);
    await t.run((ctx) =>
      ctx.db.patch("cards", link, {
        metadata: {
          linkCategory: {
            category: "research",
            fetchedAt: 2,
            pdfUrl: "https://arxiv.org/pdf/2401.00001",
            sourceUrl: PAPER,
          },
        },
      })
    );

    const next = await claim(link);

    expect(next.fileKey).not.toBe(old.fileKey);
    expect(await queuedObjectDeletions(t)).toEqual([old.fileKey]);

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workflowDispatches").collect()) {
        await ctx.db.delete("workflowDispatches", row._id);
      }
    });
    await t.mutation(internal.card.linkedPdfs.failLinkedPdf, {
      claimToken: old.claimToken,
      fileKey: old.fileKey,
      linkedPdfId: old.linkedPdfId,
    });
    expect(await queuedObjectDeletions(t)).toEqual([old.fileKey]);
    expect(
      (await t.run((ctx) => ctx.db.get("linkedPdfs", next.linkedPdfId)))?.status
    ).toBe("pending");
  });

  test("the eleventh download in a minute is rate limited", async () => {
    const { paper, t } = await setup();
    const outcomes: string[] = [];
    for (let i = 0; i < 11; i++) {
      const link = await paper({}, { url: `${PAPER}?v=${i}` });
      outcomes.push(
        await t
          .mutation(internal.card.linkedPdfs.claimLinkedPdf, {
            cardId: link,
            userId: "owner",
          })
          .then(
            () => "claimed",
            (error) => error.data.code
          )
      );
    }

    expect(outcomes.filter((o) => o === "claimed")).toHaveLength(10);
    expect(outcomes[10]).toBe("RATE_LIMITED");
  });

  test("a claim's PDF isn't reported as orphaned", async () => {
    const { paper, t } = await setup();
    const claim = await t.mutation(internal.card.linkedPdfs.claimLinkedPdf, {
      cardId: await paper(),
      userId: "owner",
    });

    expect(
      await t.query(internal.storage.orphanSweep.collectNonCardReferencedKeys)
    ).toContain(claim.fileKey);
  });

  test("deleting the link keeps the document it made", async () => {
    stubWorker();
    const { paper, save, rows, card, t, trashThenDelete } = await setup();
    const link = await paper();
    const saved = await save(link);
    const row = (await rows())[0];

    await trashThenDelete(link);

    expect(await rows()).toEqual([]);
    expect(await card(saved.cardId)).not.toBeNull();
    expect(await queuedObjectDeletions(t)).not.toContain(row?.fileKey);
  });
});
