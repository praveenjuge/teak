import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accountDeletionStage } from "../accountDeletion/stages";
import {
  LINK_CHECK_ALIVE_TTL_MS,
  LINK_CHECK_DEAD_TTL_MS,
} from "../card/linkCheck";
import schema from "../schema";
import { RATE_LIMIT_CONFIG } from "../shared/rateLimits";

const modules = import.meta.glob("../**/*.ts");
const URL_GONE = "https://example.com/gone";
const ARCHIVE_KEY = "users/owner/cards/c1/page-archive/abc123-archive.html";
const CAPTURED_AT = Date.UTC(2026, 9, 19, 12);

interface WorkerAnswer {
  httpStatus?: number;
  outcome: "alive" | "dead" | "unsure";
  reason: string;
}

/** The Files Worker: `check-link` answers with `answer`; calls are kept. */
const stubWorker = (
  answer: (url: string) => WorkerAnswer | Promise<WorkerAnswer>
) => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        op: string;
        params: { url: string };
      };
      if (body.op !== "check-link") {
        return Response.json({
          ok: true,
          version: 1,
          requestId: "r",
          data: { mutationId: "m" },
        });
      }
      urls.push(body.params.url);
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: await answer(body.params.url),
      });
    })
  );
  return urls;
};

const DEAD: WorkerAnswer = {
  httpStatus: 404,
  outcome: "dead",
  reason: "http_404",
};
const ALIVE: WorkerAnswer = { httpStatus: 200, outcome: "alive", reason: "ok" };
const UNSURE: WorkerAnswer = {
  httpStatus: 503,
  outcome: "unsure",
  reason: "http_status",
};

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const pageArchive = (fields: Partial<Doc<"cards">["pageArchive"]> = {}) => ({
  storageKey: ARCHIVE_KEY,
  bytes: 40_000,
  kind: "full" as const,
  source: "server" as const,
  capturedAt: CAPTURED_AT,
  sourceUrl: "https://www.example.com/gone",
  ...fields,
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

  const link = (
    fields: Partial<Doc<"cards">> = {},
    { archived = true }: { archived?: boolean } = {}
  ) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: URL_GONE,
        url: URL_GONE,
        createdAt: 1,
        updatedAt: 1,
        ...(archived ? { pageArchive: pageArchive() } : {}),
        ...fields,
      })
    );
  const open = (cardId: string) =>
    owner.action(api.card.linkCheck.checkCardLinkForOpen, { cardId });
  const rows = () => t.run((ctx) => ctx.db.query("linkChecks").collect());
  return { t, owner, ownerWorkosId, link, open, rows };
};

describe("opening a link card", () => {
  test("a card with no archived copy opens its original without a check", async () => {
    const urls = stubWorker(() => DEAD);
    const { link, open, rows } = await setup();
    const cardId = await link({}, { archived: false });

    expect(await open(cardId)).toEqual({ target: "original", url: URL_GONE });
    expect(urls).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test.each([
    ["someone else's card", { userId: "stranger" }],
    ["a card in Trash", { isDeleted: true, deletedAt: 1 }],
    ["a note", { type: "text" as const, url: undefined }],
    ["a link with an unsafe address", { url: "javascript:alert(1)" }],
  ])("%s is unavailable, and nothing is checked", async (_name, fields) => {
    const urls = stubWorker(() => DEAD);
    const { link, open } = await setup();
    const cardId = await link(fields);

    expect(await open(cardId)).toEqual({ target: "unavailable" });
    expect(urls).toEqual([]);
  });

  test("an address that is no card is unavailable", async () => {
    stubWorker(() => DEAD);
    const { open } = await setup();
    expect(await open("not-a-card-id")).toEqual({ target: "unavailable" });
  });

  test("a dead page opens the archived copy, and is remembered for 6 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 9));
    const urls = stubWorker(() => DEAD);
    const { link, open, rows } = await setup();
    const cardId = await link();

    const first = await open(cardId);
    expect(first).toMatchObject({
      target: "archive",
      url: URL_GONE,
      capturedAt: CAPTURED_AT,
      kind: "full",
      sourceHost: "example.com",
      outcome: "dead",
      reason: "http_404",
    });
    expect(
      first.target === "archive" &&
        first.archiveUrl?.startsWith(`https://files.test/${ARCHIVE_KEY}?`)
    ).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({ cardId, outcome: "dead", httpStatus: 404 });
    expect(row?.checkingUntil).toBeUndefined();

    vi.setSystemTime(Date.now() + LINK_CHECK_DEAD_TTL_MS - 60_000);
    expect(await open(cardId)).toMatchObject({
      target: "archive",
      outcome: "cached_dead",
    });
    expect(urls).toEqual([URL_GONE]);

    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await open(cardId)).toMatchObject({
      target: "archive",
      outcome: "dead",
    });
    expect(urls).toEqual([URL_GONE, URL_GONE]);
  });

  test("a live page opens the original, and is remembered for 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 9));
    const urls = stubWorker(() => ALIVE);
    const { link, open, rows } = await setup();
    const cardId = await link();

    expect(await open(cardId)).toEqual({
      target: "original",
      url: URL_GONE,
      outcome: "alive",
      reason: "ok",
    });
    vi.setSystemTime(Date.now() + LINK_CHECK_ALIVE_TTL_MS - 60_000);
    expect(await open(cardId)).toMatchObject({
      target: "original",
      outcome: "cached_alive",
    });
    expect(urls).toHaveLength(1);
    expect(await rows()).toMatchObject([{ outcome: "alive", httpStatus: 200 }]);

    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await open(cardId)).toMatchObject({ outcome: "alive" });
    expect(urls).toHaveLength(2);
  });

  test("an unsure answer opens the original and is never kept", async () => {
    const urls = stubWorker(() => UNSURE);
    const { link, open, rows } = await setup();
    const cardId = await link();

    expect(await open(cardId)).toEqual({
      target: "original",
      url: URL_GONE,
      outcome: "unsure",
      reason: "http_status",
    });
    expect(await rows()).toEqual([]);
    await open(cardId);
    expect(urls).toHaveLength(2);
  });

  test("an unsure answer leaves an earlier dead answer as it was", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 9));
    let answer = DEAD;
    stubWorker(() => answer);
    const { link, open, rows } = await setup();
    const cardId = await link();
    await open(cardId);
    const [dead] = await rows();

    vi.setSystemTime(Date.now() + LINK_CHECK_DEAD_TTL_MS + 1);
    answer = UNSURE;
    expect(await open(cardId)).toMatchObject({ target: "original" });
    expect(await rows()).toEqual([dead]);
  });

  test("a Worker that fails or answers nonsense counts as unsure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 }))
    );
    const { link, open, rows } = await setup();
    const cardId = await link();

    expect(await open(cardId)).toMatchObject({
      target: "original",
      outcome: "unsure",
    });
    expect(await rows()).toEqual([]);
  });

  test("past 30 checks a minute, the original opens without a check", async () => {
    const urls = stubWorker(() => UNSURE);
    const { link, open } = await setup();
    const cardId = await link();
    const limit = RATE_LIMIT_CONFIG.linkChecks.capacity;
    for (let index = 0; index < limit; index += 1) {
      await open(cardId);
    }

    expect(await open(cardId)).toEqual({
      target: "original",
      url: URL_GONE,
      outcome: "unsure",
      reason: "rate_limited",
    });
    expect(urls).toHaveLength(limit);
  });

  test("two opens at once make one check, and the second gets its answer", async () => {
    let release: (answer: WorkerAnswer) => void = () => undefined;
    const urls = stubWorker(
      () =>
        new Promise<WorkerAnswer>((resolve) => {
          release = resolve;
        })
    );
    const { link, open } = await setup();
    const cardId = await link();

    const first = open(cardId);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    const second = open(cardId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    release(DEAD);

    expect(await first).toMatchObject({ target: "archive", outcome: "dead" });
    expect(await second).toMatchObject({
      target: "archive",
      outcome: "cached_dead",
    });
    expect(urls).toHaveLength(1);
  });

  test("a second open while a check is in flight spends no rate-limit token", async () => {
    const { t, link } = await setup();
    const cardId = await link();
    await t.run((ctx) =>
      ctx.db.insert("linkChecks", {
        cardId,
        userId: "owner",
        checkingUntil: Date.now() + 60_000,
      })
    );
    for (let index = 0; index < 40; index += 1) {
      expect(
        await t.mutation(internal.card.linkCheck.claimLinkCheck, {
          cardId,
          userId: "owner",
        })
      ).toEqual({ kind: "busy" });
    }
  });

  test("an unchanged alive answer isn't written again within the hour", async () => {
    const { t, link, rows } = await setup();
    const cardId = await link();
    const checkedAt = Date.now() - 30 * 60_000;
    await t.run((ctx) =>
      ctx.db.insert("linkChecks", {
        cardId,
        userId: "owner",
        outcome: "alive",
        httpStatus: 200,
        reason: "ok",
        checkedAt,
        checkingUntil: Date.now() + 5000,
      })
    );
    const finish = (httpStatus: number) =>
      t.mutation(internal.card.linkCheck.finishLinkCheck, {
        cardId,
        userId: "owner",
        outcome: "alive",
        httpStatus,
        reason: "ok",
        url: URL_GONE,
      });

    await finish(200);
    const [unchanged] = await rows();
    expect(unchanged?.checkedAt).toBe(checkedAt);
    expect(unchanged?.checkingUntil).toBeUndefined();
    await finish(204);
    const [row] = await rows();
    expect(row?.httpStatus).toBe(204);
    expect(row?.checkedAt).toBeGreaterThan(checkedAt);
  });

  test("a card deleted during its check keeps no row", async () => {
    let release: (answer: WorkerAnswer) => void = () => undefined;
    const urls = stubWorker(
      () =>
        new Promise<WorkerAnswer>((resolve) => {
          release = resolve;
        })
    );
    const { t, link, open, rows } = await setup();
    const cardId = await link();
    const opening = open(cardId);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    await t.run((ctx) => ctx.db.delete("cards", cardId));
    release(DEAD);
    await opening;

    expect(await rows()).toEqual([]);
  });

  test("a link edited during its check doesn't keep the old link's answer", async () => {
    let release: (answer: WorkerAnswer) => void = () => undefined;
    const urls = stubWorker(
      () =>
        new Promise<WorkerAnswer>((resolve) => {
          release = resolve;
        })
    );
    const { t, link, open, rows } = await setup();
    const cardId = await link();
    const opening = open(cardId);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, {
        content: "https://example.com/moved",
        url: "https://example.com/moved",
      });
      for (const row of await ctx.db.query("linkChecks").collect()) {
        await ctx.db.delete("linkChecks", row._id);
      }
    });
    release(DEAD);
    await opening;

    expect(await rows()).toEqual([]);
  });
});

describe("the card dialog's chip", () => {
  const seedCheck = (
    t: Awaited<ReturnType<typeof setup>>["t"],
    cardId: Id<"cards">,
    outcome: "alive" | "dead",
    userId = "owner"
  ) =>
    t.run((ctx) =>
      ctx.db.insert("linkChecks", {
        cardId,
        userId,
        outcome,
        checkedAt: CAPTURED_AT,
      })
    );

  test("shows the last check when it was dead", async () => {
    const { t, owner, link } = await setup();
    const cardId = await link();
    await seedCheck(t, cardId, "dead");

    expect(
      await owner.query(api.card.linkCheck.getLinkCheck, { cardId })
    ).toEqual({ checkedAt: CAPTURED_AT, outcome: "dead" });
  });

  test("shows nothing when it was alive, or never checked", async () => {
    const { t, owner, link } = await setup();
    const checked = await link();
    const unchecked = await link();
    await seedCheck(t, checked, "alive");

    for (const cardId of [checked, unchecked]) {
      expect(
        await owner.query(api.card.linkCheck.getLinkCheck, { cardId })
      ).toBeNull();
    }
  });

  test("never shows another account's card", async () => {
    const { t, owner, link } = await setup();
    const cardId = await link({ userId: "stranger" });
    await seedCheck(t, cardId, "dead", "stranger");

    expect(
      await owner.query(api.card.linkCheck.getLinkCheck, { cardId })
    ).toBeNull();
  });
});

describe("deleting", () => {
  test("deleting a card forever removes its link check", async () => {
    stubWorker(() => DEAD);
    const { t, link, open, rows } = await setup();
    const cardId = await link();
    const kept = await link({ url: "https://example.com/kept" });
    await open(cardId);
    await open(kept);
    expect(await rows()).toHaveLength(2);

    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, { isDeleted: true, deletedAt: 1 })
    );
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      cardId,
      userId: "owner",
    });

    expect((await rows()).map((row) => row.cardId)).toEqual([kept]);
  });
});

describe("deleting an account", () => {
  test("pages through every link check, past the first page", async () => {
    const { t, ownerWorkosId, link, rows } = await setup();
    const cardId = await link();
    const strangers = await link({ userId: "stranger" });
    await t.run(async (ctx) => {
      // Only link checks need more than one page, so the stage keeps paging
      // for them alone.
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("linkChecks", {
          cardId,
          userId: "owner",
          outcome: "dead",
          checkedAt: index,
        });
      }
      await ctx.db.insert("linkChecks", {
        cardId: strangers,
        userId: "stranger",
        outcome: "dead",
        checkedAt: 1,
      });
    });
    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        workosUserId: ownerWorkosId,
        startedAt: 1,
        generation: 1,
        stage: accountDeletionStage("accountData"),
      })
    );

    let pages = 0;
    while (
      await t.mutation(internal.accountDeletionData.ancillaryPage, {
        stateId,
        generation: 1,
      })
    ) {
      pages += 1;
      expect(pages).toBeLessThan(10);
    }

    expect(pages).toBe(3);
    expect((await rows()).map((row) => row.userId)).toEqual(["stranger"]);
  });
});
