/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import { accountDeletionStage } from "../accountDeletion/stages";
import {
  INBOUND_ATTACHMENT_PATH,
  INBOUND_EMAIL_PATH,
  inboundSigningPayload,
} from "../inbound/http";
import schema from "../schema";
import { FREE_TIER_LIMIT } from "../shared/constants";
import { rateLimiter } from "../shared/rateLimits";
import { hmacSha256Hex, sha256Hex } from "../storage/r2Keys";

// Save by email (inbound/): mail the Email Worker verified becomes cards in
// the account whose sign-in email sent it, once, whatever the redeliveries.

const modules = import.meta.glob("../**/*.ts");
const SECRET = "inbound-test-secret";
const OWNER_EMAIL = "owner@example.test";

interface WorkerCall {
  op: string;
  params: Record<string, unknown>;
}

/**
 * The Files Worker: finalizes report the size they were sent; else ok. While
 * `faults.finalizes` is above zero, a finalize answers 503 and counts it down.
 */
const stubWorker = (faults = { finalizes: 0 }) => {
  const calls: WorkerCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as WorkerCall;
      calls.push({ op: body.op, params: body.params });
      if (body.op === "finalize-upload" && faults.finalizes > 0) {
        faults.finalizes -= 1;
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      const data =
        body.op === "finalize-upload"
          ? {
              destinationKey: body.params.destinationKey,
              sourceEtag: "etag-src",
              storedEtag: "etag-dst",
              storedFileSize: body.params.expectedSize,
              storedMimeType: "application/pdf",
            }
          : { mutationId: "m" };
      return Promise.resolve(
        Response.json({ ok: true, version: 1, requestId: "r", data })
      );
    })
  );
  return calls;
};

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
  vi.stubEnv("EMAIL_INBOUND_SIGNING_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const signedPost = async (
  path: string,
  body: string,
  {
    secret = SECRET,
    timestamp = String(Math.floor(Date.now() / 1000)),
  }: { secret?: string; timestamp?: string } = {}
) => ({
  body,
  headers: {
    "content-type": "application/json",
    "x-teak-signature": await hmacSha256Hex(
      secret,
      inboundSigningPayload(path, timestamp, await sha256Hex(body))
    ),
    "x-teak-timestamp": timestamp,
  },
  method: "POST",
});

/** Empties the owner's card creation bucket (30 a minute, sharded). */
const drainCardBucket = (t: { run: ReturnType<typeof convexTest>["run"] }) =>
  t.run(async (ctx) => {
    for (let i = 0; i < 200; i++) {
      await rateLimiter.limit(ctx, "cardCreation", {
        key: "owner",
        throws: false,
      });
    }
  });

/** Spends the owner's card bucket past what the next minute refills. */
const overdrawCardBucket = (t: { run: ReturnType<typeof convexTest>["run"] }) =>
  t.run(async (ctx) => {
    for (let i = 0; i < 30; i++) {
      await rateLimiter.limit(ctx, "cardCreation", {
        key: "owner",
        reserve: true,
      });
    }
  });

const email = (fields: Record<string, unknown> = {}) => ({
  attachments: [],
  date: "Tue, 14 Oct 2026 09:30:00 +0000",
  from: OWNER_EMAIL,
  html: null,
  messageId: "<one@mail.example.test>",
  subject: "Fwd: Leaves",
  text: "Today we talk about leaves and how they turn light into sugar, with a long enough body to stay a note rather than a link card.",
  v: 1,
  ...fields,
});

const setup = async (
  beforeOwner?: (t: ReturnType<typeof convexTest>) => Promise<unknown>
) => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  await beforeOwner?.(t);
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: ownerWorkosId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });
  const send = async (
    body: Record<string, unknown>,
    options?: Parameters<typeof signedPost>[2]
  ) => {
    const response = await t.fetch(
      INBOUND_EMAIL_PATH,
      await signedPost(INBOUND_EMAIL_PATH, JSON.stringify(body), options)
    );
    return {
      body: (await response.json()) as Record<string, any>,
      headers: response.headers,
      status: response.status,
    };
  };
  const finalize = async (body: Record<string, unknown>) => {
    const response = await t.fetch(
      INBOUND_ATTACHMENT_PATH,
      await signedPost(
        INBOUND_ATTACHMENT_PATH,
        JSON.stringify({ v: 1, ...body })
      )
    );
    return {
      body: (await response.json()) as Record<string, any>,
      status: response.status,
    };
  };
  const cards = () =>
    t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_saved", (q) => q.eq("userId", "owner"))
        .collect()
    );
  const receipts = () =>
    t.run((ctx) => ctx.db.query("inboundEmailReceipts").collect());
  const atCardLimit = () =>
    t.run((ctx) =>
      ctx.db.insert("userCardUsage", {
        userId: "owner",
        activeCardCount: FREE_TIER_LIMIT,
        isCountExact: true,
        isSaturated: true,
        updatedAt: Date.now(),
      })
    );
  return {
    atCardLimit,
    cards,
    finalize,
    owner,
    ownerWorkosId,
    receipts,
    send,
    t,
  };
};

describe("Settings", () => {
  test("off until turned on, with the shared address and the sign-in email", async () => {
    const { owner } = await setup();

    expect(await owner.query(api.inbound.settings.getMine, {})).toEqual({
      address: "save@in.teakvault.com",
      enabled: false,
      lastReceivedAt: null,
      sender: OWNER_EMAIL,
      senderVerified: true,
    });
    await owner.mutation(api.inbound.settings.enable, {});
    expect((await owner.query(api.inbound.settings.getMine, {}))?.enabled).toBe(
      true
    );
    await owner.mutation(api.inbound.settings.disable, {});
    expect((await owner.query(api.inbound.settings.getMine, {}))?.enabled).toBe(
      false
    );
  });

  test("the dev deployment's domain comes from INBOUND_EMAIL_DOMAIN", async () => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "In-Dev.TeakVault.com");
    const { owner } = await setup();
    expect((await owner.query(api.inbound.settings.getMine, {}))?.address).toBe(
      "save@in-dev.teakvault.com"
    );
  });

  test("an unverified sign-in email can't save or turn it on, but can turn it off and stays off once verified", async () => {
    const { cards, owner, send, t } = await setup();
    const setVerified = (emailVerified: boolean) =>
      t.run(async (ctx) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", "owner"))
          .unique();
        if (!user) {
          throw new Error("expected the owner");
        }
        await ctx.db.patch(user._id, { emailVerified });
      });
    await owner.mutation(api.inbound.settings.enable, {});
    await setVerified(false);
    expect(await owner.query(api.inbound.settings.getMine, {})).toMatchObject({
      enabled: true,
      sender: OWNER_EMAIL,
      senderVerified: false,
    });
    expect((await send(email())).status).toBe(404);
    expect(await cards()).toEqual([]);

    await owner.mutation(api.inbound.settings.disable, {});
    await expect(
      owner.mutation(api.inbound.settings.enable, {})
    ).rejects.toThrow(/Verify your sign-in email/);
    await setVerified(true);
    expect(await owner.query(api.inbound.settings.getMine, {})).toMatchObject({
      enabled: false,
      senderVerified: true,
    });
  });

  test("signed out sees nothing and can't change it", async () => {
    const { t } = await setup();
    expect(await t.query(api.inbound.settings.getMine, {})).toBeNull();
    await expect(t.mutation(api.inbound.settings.enable, {})).rejects.toThrow(
      "User must be authenticated"
    );
  });

  test("too many changes are refused for a minute", async () => {
    const { owner } = await setup();
    for (let i = 0; i < 10; i++) {
      await owner.mutation(
        i % 2 === 0
          ? api.inbound.settings.enable
          : api.inbound.settings.disable,
        {}
      );
    }
    await expect(
      owner.mutation(api.inbound.settings.enable, {})
    ).rejects.toThrow("Too many changes");
  });
});

describe("POST /inbound/email", () => {
  test("a note from the owner becomes a text card tagged email", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    const { body, status } = await send(email());

    expect(status).toBe(200);
    expect(body).toEqual({ receiptKey: null, status: "saved", uploads: [] });
    const [card] = await cards();
    expect(card).toMatchObject({
      metadata: { source: "email" },
      tags: ["email"],
      type: "text",
    });
    expect(card?.content.startsWith("# Leaves\n\n")).toBe(true);
    expect(
      (await owner.query(api.inbound.settings.getMine, {}))?.lastReceivedAt
    ).toEqual(expect.any(Number));
  });

  test("one link and a sentence becomes a link card with the sentence as notes", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    await send(
      email({
        text: "Worth a read: https://example.com/article?utm_source=mail",
      })
    );

    expect(await cards()).toEqual([
      expect.objectContaining({
        notes: "Worth a read:",
        tags: ["email"],
        type: "link",
        url: "https://example.com/article",
      }),
    ]);
  });

  test("a link already in Teak, emailed with a sentence, makes a new card that keeps it", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    await send(email({ text: "https://example.com/article" }));
    await send(
      email({
        messageId: "<two@mail.example.test>",
        text: "Worth a read: https://example.com/article",
      })
    );

    const saved = await cards();
    expect(saved).toHaveLength(2);
    expect(saved).toContainEqual(
      expect.objectContaining({ notes: "Worth a read:", type: "link" })
    );
  });

  test("a bare link already in Teak, emailed again, moves that card to the top", async () => {
    vi.useFakeTimers();
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    await send(email({ text: "https://example.com/article" }));
    const [first] = await cards();
    vi.advanceTimersByTime(60_000);
    await send(
      email({
        messageId: "<two@mail.example.test>",
        text: "https://example.com/article?utm_source=mail",
      })
    );

    const saved = await cards();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.savedAt).toBeGreaterThan(first?.savedAt ?? 0);
    expect(saved[0]?.createdAt).toBe(first?.createdAt);
  });

  test("mail from an account whose WorkOS identity was deleted is rejected", async () => {
    const { cards, owner, send, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", "owner"))
        .unique();
      if (!user) {
        throw new Error("expected the owner");
      }
      await ctx.db.patch(user._id, { workosDeletedAt: Date.now() });
    });
    expect((await send(email())).status).toBe(404);
    expect(await cards()).toEqual([]);
  });

  test("a deleted account that had the same email doesn't block the new one", async () => {
    const { cards, owner, send, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    // Someone deletes their account and signs up again with the same email:
    // the old owner row stays, deleted, with that address.
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "teak_old_owner",
        identityOrigin: "workos",
        email: OWNER_EMAIL,
        emailVerified: true,
        workosUserId: "user_old_owner",
        deletedAt: Date.now() - 1000,
        workosDeletedAt: Date.now() - 1000,
      })
    );
    expect((await send(email())).status).toBe(200);
    expect(await cards()).toHaveLength(1);
  });

  test("many earlier deleted accounts with the same email don't hide the live one", async () => {
    // Each was deleted before the address signed up again, so they come first.
    const { cards, owner, send } = await setup((t) =>
      t.run(async (ctx) => {
        for (let index = 0; index < 25; index += 1) {
          await ctx.db.insert("users", {
            teakUserId: `teak_old_owner_${index}`,
            identityOrigin: "workos",
            email: OWNER_EMAIL,
            emailVerified: true,
            workosUserId: `user_old_owner_${index}`,
            deletedAt: Date.now() - 1000,
            workosDeletedAt: Date.now() - 1000,
          });
        }
      })
    );
    await owner.mutation(api.inbound.settings.enable, {});
    expect((await send(email())).status).toBe(200);
    expect(await cards()).toHaveLength(1);
  });

  test("mail from an account that hasn't turned it on, or no account, is rejected", async () => {
    const { cards, owner, receipts, send } = await setup();

    expect((await send(email())).status).toBe(404);
    expect((await send(email({ from: "stranger@example.test" }))).body).toEqual(
      { error: "unknown_sender" }
    );
    await owner.mutation(api.inbound.settings.enable, {});
    await owner.mutation(api.inbound.settings.disable, {});
    expect((await send(email())).status).toBe(404);
    expect(await cards()).toEqual([]);
    expect(await receipts()).toEqual([]);
  });

  test("the sender matches the sign-in email whatever its letter case", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    expect((await send(email({ from: "Owner@Example.TEST" }))).status).toBe(
      200
    );
    expect(await cards()).toHaveLength(1);
  });

  test("a subject cut at its limit never ends inside a character", async () => {
    const ctx = await setup();
    await ctx.owner.mutation(api.inbound.settings.enable, {});
    // The emoji's two UTF-16 units straddle the 998-unit cut.
    const subject = `${"s".repeat(997)}😀 and more`;
    const sent = await ctx.send(email({ subject }));
    expect(sent.status).toBe(200);
    const [card] = await ctx.cards();
    expect(card?.content.startsWith(`# ${"s".repeat(997)}\n`)).toBe(true);
    expect(card?.content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  test("a redelivered email is saved once", async () => {
    const { cards, owner, receipts, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    expect((await send(email())).body.status).toBe("saved");
    expect((await send(email())).body.status).toBe("duplicate");
    expect(await cards()).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
  });

  test("without a Message-ID, a retry is one card but a later resend is another", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    const noId = email({ messageId: null });

    await send(noId);
    await send(noId);
    expect(await cards()).toHaveLength(1);
    await send({ ...noId, date: "Wed, 15 Oct 2026 09:30:00 +0000" });
    expect(await cards()).toHaveLength(2);
  });

  test("ten parallel deliveries of one email make one card", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});

    const results = await Promise.all(
      Array.from({ length: 10 }, () => send(email()))
    );

    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(await cards()).toHaveLength(1);
  });

  test("at the free card limit, mail is dropped silently", async () => {
    const { atCardLimit, cards, owner, receipts, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    await atCardLimit();

    const { body, status } = await send(email());

    expect(status).toBe(200);
    expect(body.status).toBe("dropped");
    expect(await cards()).toEqual([]);
    expect((await receipts())[0]?.outcome).toBe("dropped_limit");
  });

  test("past 60 emails an hour, mail is dropped silently", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    for (let i = 0; i < 60; i++) {
      // Empty mail still counts, without touching the card bucket.
      await send(
        email({ html: null, messageId: `<m${i}@x>`, subject: "", text: null })
      );
    }

    const { body } = await send(email({ messageId: "<m61@x>" }));

    expect(body.status).toBe("dropped");
    expect(await cards()).toEqual([]);
  });

  test("an empty card bucket answers 503 and keeps nothing, so the retry saves once", async () => {
    vi.useFakeTimers();
    const { cards, owner, receipts, send, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    await drainCardBucket(t);

    const deferred = await send(email());
    expect(deferred.status).toBe(503);
    expect(deferred.body).toEqual({ error: "rate_limited" });
    expect(Number(deferred.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await receipts()).toEqual([]);

    vi.advanceTimersByTime(60_000);
    expect((await send(email())).body.status).toBe("saved");
    expect(await cards()).toHaveLength(1);
  });

  test("an empty email with no attachments saves nothing", async () => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    expect(
      (await send(email({ subject: "", text: null, html: null }))).body.status
    ).toBe("empty");
    expect(await cards()).toEqual([]);
  });

  test.each([
    ["a wrong secret", { secret: "other" }],
    [
      "a timestamp six minutes off",
      {
        timestamp: String(Math.floor(Date.now() / 1000) - 360),
      },
    ],
  ])("%s is refused", async (_name, options) => {
    const { cards, owner, send } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    expect((await send(email(), options)).status).toBe(401);
    expect(await cards()).toEqual([]);
  });

  test("a tampered body is refused", async () => {
    const { cards, owner, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    const signed = await signedPost(
      INBOUND_EMAIL_PATH,
      JSON.stringify(email())
    );
    const response = await t.fetch(INBOUND_EMAIL_PATH, {
      ...signed,
      body: JSON.stringify(email({ text: "tampered" })),
    });
    expect(response.status).toBe(401);
    expect(await cards()).toEqual([]);
  });

  test("an attachment request's signature doesn't open the email route", async () => {
    const { owner, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    const response = await t.fetch(
      INBOUND_EMAIL_PATH,
      await signedPost(INBOUND_ATTACHMENT_PATH, JSON.stringify(email()))
    );
    expect(response.status).toBe(401);
  });

  test("without the signing secret the route is unavailable", async () => {
    vi.stubEnv("EMAIL_INBOUND_SIGNING_SECRET", "");
    const { send } = await setup();
    expect((await send(email())).status).toBe(503);
  });
});

describe("attachments", () => {
  const pdf = (index: number, fields: Record<string, unknown> = {}) => ({
    fileName: `report-${index}.pdf`,
    index,
    mimeType: "application/pdf",
    size: 2048,
    ...fields,
  });

  const sendWithAttachments = async (
    ctx: Awaited<ReturnType<typeof setup>>,
    attachments: Record<string, unknown>[],
    fields: Record<string, unknown> = {}
  ) => {
    await ctx.owner.mutation(api.inbound.settings.enable, {});
    return (await ctx.send(email({ attachments, ...fields }))).body;
  };

  test("each attachment uploads, then becomes its own card tagged email", async () => {
    const calls = stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0), pdf(1)]);

    expect(sent.status).toBe("saved");
    expect(
      sent.uploads.map((upload: { index: number }) => upload.index)
    ).toEqual([0, 1]);
    for (const upload of sent.uploads) {
      expect(upload.uploadUrl).toMatch(/^https:\/\/files\.test\//);
      const result = await ctx.finalize({
        fileKey: upload.fileKey,
        index: upload.index,
        receiptKey: sent.receiptKey,
        size: 2048,
      });
      expect(result).toEqual({
        body: { cardId: expect.any(String), status: "saved" },
        status: 200,
      });
    }

    const cards = await ctx.cards();
    expect(cards).toHaveLength(3);
    const files = cards.filter((card) => card.type === "document");
    expect(files).toHaveLength(2);
    for (const card of files) {
      expect(card.tags).toEqual(["email"]);
      expect(card.metadata).toEqual({ source: "email" });
      // The card points at the promoted object, never the pending one the
      // stale-upload sweep clears.
      expect(card.fileKey).toContain("/stored/file/");
      expect(card.fileKey).not.toContain("upload-pending");
    }
    const receipt = (await ctx.receipts())[0];
    expect(receipt?.pendingAttachments?.map((item) => item.state)).toEqual([
      "done",
      "done",
    ]);
    expect(receipt?.cardIds).toHaveLength(3);
    expect(calls.filter((call) => call.op === "finalize-upload")).toHaveLength(
      2
    );
  });

  test("an email with only attachments makes only file cards", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await ctx.finalize({
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });
    expect((await ctx.cards()).map((card) => card.type)).toEqual(["document"]);
  });

  test("a finalize retried, or two at once, make one card", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)]);
    const request = {
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    };

    const [first, second] = await Promise.all([
      ctx.finalize(request),
      ctx.finalize(request),
    ]);
    const third = await ctx.finalize(request);

    const statuses = [first.body.status, second.body.status].sort();
    expect(["in_progress,saved", "saved,saved"]).toContain(statuses.join(","));
    expect(third.body.status).toBe("saved");
    expect(
      (await ctx.cards()).filter((card) => card.type === "document")
    ).toHaveLength(1);
  });

  test("a claim left by a finalize that died is taken over after two minutes", async () => {
    vi.useFakeTimers();
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)]);
    await ctx.t.mutation(internal.inbound.ingest.claimEmailAttachment, {
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });
    const request = {
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    };

    expect((await ctx.finalize(request)).status).toBe(202);
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect((await ctx.finalize(request)).body.status).toBe("saved");
  });

  test("a claim whose finalize died is finished by a follow-up, with no new request", async () => {
    vi.useFakeTimers();
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await ctx.t.mutation(internal.inbound.ingest.claimEmailAttachment, {
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });

    const answer = await ctx.finalize({
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });
    expect(answer).toEqual({ body: { status: "in_progress" }, status: 202 });
    expect(await ctx.cards()).toEqual([]);

    vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
    await ctx.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await ctx.cards()).map((card) => card.type)).toEqual(["document"]);
  });

  test("a redelivered email re-signs only the attachments not yet saved", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0), pdf(1)]);
    await ctx.finalize({
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });

    const again = (await ctx.send(email({ attachments: [pdf(0), pdf(1)] })))
      .body;

    expect(again.status).toBe("duplicate");
    expect(again.receiptKey).toBe(sent.receiptKey);
    expect(again.uploads).toEqual([
      expect.objectContaining({ fileKey: sent.uploads[1].fileKey, index: 1 }),
    ]);
    await ctx.finalize({
      fileKey: again.uploads[0].fileKey,
      index: 1,
      receiptKey: again.receiptKey,
    });
    expect(await ctx.cards()).toHaveLength(3);
  });

  test("a key from another attachment or account is refused", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0), pdf(1)]);

    const swapped = await ctx.finalize({
      fileKey: sent.uploads[1].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });
    const forged = await ctx.finalize({
      fileKey: "users/someone-else/cards/upload-pending-v2/file/x.pdf",
      index: 0,
      receiptKey: sent.receiptKey,
    });

    expect(swapped.status).toBe(404);
    expect(forged.status).toBe(404);
    expect(
      (await ctx.cards()).filter((card) => card.type === "document")
    ).toEqual([]);
  });

  test("a long file name is cut on a whole character and keeps its extension", async () => {
    stubWorker();
    const ctx = await setup();
    // The emoji's two UTF-16 units straddle the cut before ".pdf".
    const fileName = `${"a".repeat(235)}😀${"b".repeat(20)}.pdf`;
    const sent = await sendWithAttachments(ctx, [pdf(0, { fileName })]);
    expect(sent.uploads).toHaveLength(1);
    const [receipt] = await ctx.receipts();
    expect(receipt?.pendingAttachments?.[0]?.fileName).toBe(
      `${"a".repeat(235)}.pdf`
    );
  });

  test("a long design-tokens name keeps its compound extension", async () => {
    stubWorker();
    const ctx = await setup();
    const fileName = `${"a".repeat(300)}.tokens.json`;
    const sent = await sendWithAttachments(ctx, [
      pdf(0, { fileName, mimeType: "application/json" }),
    ]);
    expect(sent.uploads).toHaveLength(1);
    const [receipt] = await ctx.receipts();
    const stored = receipt?.pendingAttachments?.[0]?.fileName ?? "";
    expect(stored.endsWith(".tokens.json")).toBe(true);
    expect(stored.length).toBeLessThanOrEqual(240);
  });

  test("an error that isn't about the file fails the email, so the sender retries", async () => {
    stubWorker();
    const ctx = await setup();
    await ctx.owner.mutation(api.inbound.settings.enable, {});
    // The account is being deleted: no upload is minted and nothing is kept.
    await ctx.t.run((db) =>
      db.db.insert("accountDeletionStates", {
        generation: 1,
        stage: accountDeletionStage("accountData"),
        startedAt: Date.now(),
        userId: "owner",
        workosUserId: ctx.ownerWorkosId,
      })
    );
    const sent = await ctx.send(email({ attachments: [pdf(0)] }));
    expect(sent.status).toBe(500);
    expect(await ctx.receipts()).toEqual([]);
  });

  test("files Teak doesn't take get no upload", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [
      pdf(0, { fileName: "setup.exe", mimeType: "application/x-msdownload" }),
      pdf(1, { size: 101 * 1024 * 1024 }),
      pdf(2),
    ]);
    expect(
      sent.uploads.map((upload: { index: number }) => upload.index)
    ).toEqual([2]);
  });

  test("an attachment over the card limit is dropped and its upload deleted", async () => {
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await ctx.atCardLimit();

    const result = await ctx.finalize({
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });

    expect(result.body.status).toBe("dropped");
    expect(await ctx.cards()).toEqual([]);
    expect(await queuedObjectDeletions(ctx.t)).toContain(
      sent.uploads[0].fileKey
    );
  });

  test("an empty card bucket schedules the attachment for when it refills", async () => {
    vi.useFakeTimers();
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await drainCardBucket(ctx.t);

    const result = await ctx.finalize({
      fileKey: sent.uploads[0].fileKey,
      index: 0,
      receiptKey: sent.receiptKey,
    });
    expect(result).toEqual({ body: { status: "scheduled" }, status: 202 });
    expect(await ctx.cards()).toEqual([]);

    vi.advanceTimersByTime(60_000);
    await ctx.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await ctx.cards()).map((card) => card.type)).toEqual(["document"]);
  });

  test("a finalize that keeps finding an empty card bucket stops rescheduling", async () => {
    vi.useFakeTimers();
    stubWorker();
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await drainCardBucket(ctx.t);
    expect(
      (
        await ctx.finalize({
          fileKey: sent.uploads[0].fileKey,
          index: 0,
          receiptKey: sent.receiptKey,
        })
      ).body
    ).toEqual({ status: "scheduled" });

    const pendingRetries = () =>
      ctx.t.run(async (db) =>
        (await db.db.system.query("_scheduled_functions").collect()).filter(
          (job) =>
            job.name.includes("retryEmailAttachment") &&
            job.state.kind === "pending"
        )
      );
    let runs = 0;
    for (; runs < 60; runs++) {
      const [job] = await pendingRetries();
      if (!job) {
        break;
      }
      // Empty the bucket just before each retry runs, so it is refused again.
      await vi.advanceTimersByTimeAsync(
        Math.max(0, job.scheduledTime - Date.now() - 1)
      );
      await overdrawCardBucket(ctx.t);
      await vi.advanceTimersByTimeAsync(1);
      await ctx.t.finishInProgressScheduledFunctions();
    }
    expect(runs).toBeLessThan(60);
    expect(await pendingRetries()).toEqual([]);
    expect(await ctx.cards()).toEqual([]);
    // Released, not dropped, so a redelivery of the email can still save it.
    expect(
      (await ctx.receipts())[0]?.pendingAttachments?.map((item) => item.state)
    ).toEqual(["unclaimed"]);
  });

  test("a scheduled finalize that hits a Files Worker fault is followed up", async () => {
    vi.useFakeTimers();
    const faults = { finalizes: 0 };
    stubWorker(faults);
    const ctx = await setup();
    const sent = await sendWithAttachments(ctx, [pdf(0)], {
      html: null,
      subject: "",
      text: null,
    });
    await drainCardBucket(ctx.t);
    expect(
      (
        await ctx.finalize({
          fileKey: sent.uploads[0].fileKey,
          index: 0,
          receiptKey: sent.receiptKey,
        })
      ).body
    ).toEqual({ status: "scheduled" });

    // The refilled bucket's finalize gets a 503; its follow-up saves it.
    faults.finalizes = 1;
    vi.advanceTimersByTime(60_000);
    await ctx.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await ctx.cards()).map((card) => card.type)).toEqual(["document"]);
    expect(
      (await ctx.receipts())[0]?.pendingAttachments?.map((item) => item.state)
    ).toEqual(["done"]);
  });
});

describe("account deletion and retention", () => {
  test("receipts older than 30 days are pruned", async () => {
    const { owner, receipts, send, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    await send(email());
    await t.run(async (ctx) => {
      for (const receipt of await ctx.db
        .query("inboundEmailReceipts")
        .collect()) {
        await ctx.db.patch("inboundEmailReceipts", receipt._id, {
          createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
        });
      }
    });
    await send(email({ messageId: "<new@x>" }));

    expect(await t.mutation(internal.inbound.ingest.pruneReceipts, {})).toEqual(
      { deleted: 1, hasMore: false }
    );
    expect(await receipts()).toHaveLength(1);
  });

  test("the account's settings and receipts are deleted with it", async () => {
    const { owner, ownerWorkosId, send, t } = await setup();
    await owner.mutation(api.inbound.settings.enable, {});
    await send(email());
    await send(email({ messageId: "<second@mail.example.org>" }));
    const userId = "owner";
    const rows = () =>
      t.run(async (ctx) => [
        ...(await ctx.db
          .query("inboundEmailSettings")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect()),
        ...(await ctx.db
          .query("inboundEmailReceipts")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect()),
      ]);
    expect(await rows()).toHaveLength(3);

    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: accountDeletionStage("accountData"),
        startedAt: Date.now(),
        userId,
        workosUserId: ownerWorkosId,
      })
    );
    for (let page = 0; page < 10; page += 1) {
      const more = await t.mutation(
        internal.accountDeletionData.ancillaryPage,
        {
          generation: 1,
          stateId,
        }
      );
      if (!more) {
        break;
      }
    }
    expect(await rows()).toEqual([]);
  });
});
