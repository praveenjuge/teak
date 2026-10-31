import { describe, expect, test } from "bun:test";
import type { FilesOp } from "@teak/files-protocol";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { createFakeStep } from "../../test/fakeStep";
import {
  captureScreenshotStep,
  parseScreenshotRetryableError,
  SCREENSHOT_RETRYABLE_PREFIX,
  SCREENSHOT_STEP,
} from "./screenshot";

const URL_ = "https://example.com/article";
const PAGE: OpAnswer = {
  data: {
    charset: "utf-8",
    fetched: true,
    htmlGzipBase64: "H4sIAAAAAAAAA7PJMLTzSM3JyVcozy/KSQEAqZ/2YREAAAA=",
    pageUrl: URL_,
    selectors: [],
    source: "static",
  },
};
const CAPTURED: OpAnswer = { data: { height: 900, width: 1440 } };
const BUSY = new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r");

const linkCard = (preview: Record<string, unknown> = {}) =>
  makeCard({
    metadata: { linkPreview: { status: "success", ...preview } },
    type: "link",
    url: URL_,
  });

const setup = (
  card: FakeCard,
  answers: Partial<
    Record<FilesOp, OpAnswer | ((params: Record<string, unknown>) => OpAnswer)>
  >,
  handlers: Parameters<typeof createCardConvex>[1] = {},
  { refresh = false }: { refresh?: boolean } = {}
) => {
  const convex = createCardConvex(card, handlers);
  const fakes = createFakeOps(answers);
  const env = testEnv();
  const job = {
    ...testJob(env, testDeps(env, convex.fetcher, fakes.ops)),
    ...(refresh ? { refresh } : {}),
  };
  const history = () =>
    convex.stageWrites
      .filter((write) => write.stage === "screenshot")
      .map((write) => write.status);
  return {
    capture: (attempt = 1, options?: { lastAttempt?: boolean }) =>
      captureScreenshotStep(job, attempt, options),
    card,
    convex,
    fakes,
    history,
  };
};

describe("parseScreenshotRetryableError", () => {
  test("recovers the payload thrown by the capture", () => {
    const payload = { message: "HTTP 503", type: "http_error" };
    expect(
      parseScreenshotRetryableError(
        new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(payload)}`)
      )
    ).toEqual(payload);
  });

  test.each([
    ["a non-Error value", "workflow:screenshot:retryable:{}"],
    ["null", null],
    ["an ordinary error", new Error("socket hang up")],
    [
      "a prefixed error with malformed JSON",
      new Error(`${SCREENSHOT_RETRYABLE_PREFIX}{not json`),
    ],
  ])("treats %s as non-retryable", (_name, error) => {
    expect(parseScreenshotRetryableError(error)).toBeNull();
  });
});

describe("screenshot", () => {
  test("renders the cached page, stores it, and completes the stage", async () => {
    const { capture, convex, fakes, history } = setup(linkCard(), {
      "capture-screenshot": CAPTURED,
      "fetch-link-page": PAGE,
    });

    expect(await capture()).toEqual({ status: "captured" });
    const params = fakes.calls.find((call) => call.op === "capture-screenshot")
      ?.params as Record<string, string>;
    expect(params.htmlGzipBase64).toBe(
      (PAGE as { data: { htmlGzipBase64: string } }).data.htmlGzipBase64
    );
    expect(params.destinationKey).toContain(`/${CARD_ID}/screenshot/`);
    expect(convex.callsTo("storage/ownership:registerObject")[0]?.args).toEqual(
      { key: params.destinationKey, userId: USER_ID }
    );
    expect(
      convex.callsTo("linkMetadata:updateCardScreenshot")[0]?.args
    ).toMatchObject({
      screenshotHeight: 900,
      screenshotStorageKey: params.destinationKey,
      screenshotWidth: 1440,
    });
    expect(history()).toEqual(["in_progress", "completed"]);
  });

  test.each([
    ["a non-HTML page", { reason: "unsupported_type" }, "not_html"],
    ["a missing page", { reason: "http_error", status: 404 }, "http_404"],
    ["a disallowed page", { reason: "blocked_url" }, "blocked_url"],
  ])("records %s as failed with its reason", async (_name, data, reason) => {
    const { capture, card, fakes } = setup(linkCard(), {
      "fetch-link-page": { data: { fetched: false, ...data } },
    });
    expect(await capture()).toEqual({ reason, status: "failed" });
    expect(card.processingStatus?.screenshot).toMatchObject({
      status: "failed",
    });
    expect(fakes.opsCalled()).toEqual(["fetch-link-page"]);
  });

  const ARCHIVE_KEY = `users/u/cards/${CARD_ID}/page-archive/r1-archive.html`;
  const archivedCard = (kind: "full" | "text_only") =>
    Object.assign(linkCard(), {
      pageArchive: { kind, storageKey: ARCHIVE_KEY },
    });

  test("renders the saved copy, styles and all, without fetching the page", async () => {
    const { capture, convex, fakes } = setup(archivedCard("full"), {
      "capture-screenshot": CAPTURED,
    });

    expect(await capture()).toEqual({ status: "captured" });
    expect(fakes.opsCalled()).toEqual(["capture-screenshot"]);
    const params = fakes.calls[0]?.params as Record<string, string>;
    expect(params).toEqual({
      archiveKey: ARCHIVE_KEY,
      destinationKey: expect.stringContaining(`/${CARD_ID}/screenshot/`),
    });
    expect(
      convex.callsTo("linkMetadata:updateCardScreenshot")[0]?.args
    ).toMatchObject({ screenshotStorageKey: params.destinationKey });
  });

  test("falls back to the page when the saved copy is declined, under the same key", async () => {
    const { capture, convex, fakes } = setup(archivedCard("full"), {
      "capture-screenshot": (params) =>
        params.archiveKey
          ? { fallback: "NOT_FOUND", message: "source_not_found" }
          : CAPTURED,
      "fetch-link-page": PAGE,
    });

    expect(await capture()).toEqual({ status: "captured" });
    expect(fakes.opsCalled()).toEqual([
      "capture-screenshot",
      "fetch-link-page",
      "capture-screenshot",
    ]);
    const [fromCopy, fromPage] = fakes.calls
      .filter((call) => call.op === "capture-screenshot")
      .map((call) => call.params as Record<string, string>);
    expect(fromPage?.htmlGzipBase64).toBeDefined();
    expect(fromPage?.destinationKey).toBe(fromCopy?.destinationKey);
    expect(convex.callsTo("storage/ownership:registerObject")).toHaveLength(1);
  });

  test("a text-only copy is skipped for the page", async () => {
    const { capture, fakes } = setup(archivedCard("text_only"), {
      "capture-screenshot": CAPTURED,
      "fetch-link-page": PAGE,
    });

    expect(await capture()).toEqual({ status: "captured" });
    expect(fakes.opsCalled()).toEqual([
      "fetch-link-page",
      "capture-screenshot",
    ]);
  });

  test("records a page the renderer declines as failed", async () => {
    const { capture } = setup(linkCard(), {
      "capture-screenshot": { fallback: "UNSUPPORTED", message: "too tall" },
      "fetch-link-page": PAGE,
    });
    expect(await capture()).toEqual({
      reason: "declined:unsupported:too tall",
      status: "failed",
    });
  });

  test("a link that already has a screenshot is left alone", async () => {
    const { capture, fakes, history } = setup(
      linkCard({ screenshotStorageKey: "users/x/cards/c/screenshot/s" }),
      {}
    );
    expect(await capture()).toEqual({ status: "skipped" });
    expect(fakes.calls).toEqual([]);
    expect(history()).toEqual(["in_progress", "completed"]);
  });

  test("a refresh takes the screenshot again", async () => {
    const { capture, fakes } = setup(
      linkCard({ screenshotStorageKey: "users/x/cards/c/screenshot/s" }),
      { "capture-screenshot": CAPTURED, "fetch-link-page": PAGE },
      {},
      { refresh: true }
    );
    expect(await capture()).toEqual({ status: "captured" });
    expect(fakes.opsCalled()).toEqual([
      "fetch-link-page",
      "capture-screenshot",
    ]);
  });

  test("a page server error retries once, then fails the stage quietly", async () => {
    const answers = {
      "fetch-link-page": {
        data: { fetched: false, reason: "http_error", status: 503 },
      },
    };
    const first = setup(linkCard(), answers);
    await expect(first.capture(1)).rejects.toThrow(/"type":"http_error"/);
    const second = setup(linkCard(), answers);
    expect(await second.capture(2)).toEqual({
      reason: "http_error",
      status: "failed",
    });
    expect(second.card.processingStatus?.screenshot).toMatchObject({
      error: "http_error",
      status: "failed",
    });
  });

  test("an unexpected error fails the stage and is rethrown", async () => {
    const { capture, card } = setup(
      linkCard(),
      { "capture-screenshot": CAPTURED, "fetch-link-page": PAGE },
      {
        "linkMetadata:updateCardScreenshot": () => {
          throw new Error("screenshot_key_conflict");
        },
      }
    );
    await expect(capture()).rejects.toThrow("screenshot_key_conflict");
    expect(card.processingStatus?.screenshot).toMatchObject({
      error: "screenshot_error",
      status: "failed",
    });
  });

  test("a busy renderer is retried 3 times, 30 s apart, then the stage fails", async () => {
    const { card, convex, fakes } = setup(linkCard(), {
      "capture-screenshot": { throws: BUSY },
      "fetch-link-page": PAGE,
    });
    const env = testEnv();
    const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
    const fakeStep = createFakeStep();

    const outcome = await fakeStep.step.do(
      "capture screenshot",
      SCREENSHOT_STEP,
      (ctx) => captureScreenshotStep(job, ctx.attempt)
    );

    expect(outcome).toEqual({
      reason: "renderer_unavailable",
      status: "failed",
    });
    expect(fakeStep.delays.map((delay) => delay.delay)).toEqual([
      30_000, 30_000, 30_000,
    ]);
    expect(card.processingStatus?.screenshot).toMatchObject({
      error: "renderer_unavailable",
      status: "failed",
    });
  });

  test("a page server error waits 5 s before its one retry", async () => {
    let calls = 0;
    const { convex, fakes } = setup(linkCard(), {
      "capture-screenshot": CAPTURED,
      "fetch-link-page": () => {
        calls += 1;
        return calls === 1
          ? { data: { fetched: false, reason: "http_error", status: 502 } }
          : PAGE;
      },
    });
    const env = testEnv();
    const job = testJob(env, testDeps(env, convex.fetcher, fakes.ops));
    const fakeStep = createFakeStep();

    expect(
      await fakeStep.step.do("capture screenshot", SCREENSHOT_STEP, (ctx) =>
        captureScreenshotStep(job, ctx.attempt)
      )
    ).toEqual({ status: "captured" });
    expect(fakeStep.delays.map((delay) => delay.delay)).toEqual([5000]);
  });

  test("a last attempt records a retryable failure instead of throwing", async () => {
    const { capture } = setup(linkCard(), {
      "capture-screenshot": { throws: BUSY },
      "fetch-link-page": PAGE,
    });
    expect(await capture(1, { lastAttempt: true })).toEqual({
      reason: "renderer_unavailable",
      status: "failed",
    });
  });
});
