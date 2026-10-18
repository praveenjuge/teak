import { describe, expect, test } from "bun:test";
import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import { buildSelectorResultsFromHtml } from "@teak/convex/linkMetadata/staticHtml";
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
  textMetadataAnswer,
} from "../../test/cardProcessingKit";
import { TEST_CONVEX_SITE_URL } from "../../test/fakeConvex";
import { createFakeStep } from "../../test/fakeStep";
import { AI_CAPACITY_RETRIES, runCardProcessing } from "./run";

const gzipBase64 = async (text: string) => {
  const bytes = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer()
  );
  return btoa(String.fromCharCode(...bytes));
};

const PAGE_HTML = `<html><head>
  <title>Fallback</title>
  <meta property="og:title" content="A good article">
  <meta property="og:description" content="About good things">
</head><body></body></html>`;

const linkPage = async () => ({
  data: {
    charset: "utf-8",
    fetched: true,
    htmlGzipBase64: await gzipBase64(PAGE_HTML),
    pageUrl: "https://example.com/article",
    selectors: buildSelectorResultsFromHtml(PAGE_HTML, SCRAPE_ELEMENTS),
    source: "static",
  },
});

const clefAnswer = (decision: null) => ({
  data: { decision, model: "@cf/cloudflare/clef", version: 1 },
});

/** Clef reviews notes and guessed link categories; here it never objects. */
const NO_DECISIONS: Partial<Record<FilesOp, OpAnswer>> = {
  "decide-card-type": clefAnswer(null),
  "decide-link-category": clefAnswer(null),
};

const setup = (
  card: FakeCard | null,
  answers: Partial<Record<FilesOp, OpAnswer | (() => OpAnswer)>>,
  options: {
    handlers?: Parameters<typeof createCardConvex>[1];
    refresh?: boolean;
    rev?: number;
    step?: Parameters<typeof createFakeStep>[0];
  } = {}
) => {
  const convex = createCardConvex(card, options.handlers);
  const ops = createFakeOps({ ...NO_DECISIONS, ...answers });
  const fakeStep = createFakeStep(options.step);
  const env = testEnv();
  const run = () =>
    runCardProcessing(
      {
        env,
        instanceId: `card-${CARD_ID}-${options.rev ?? 1}`,
        params: {
          cardId: CARD_ID,
          convexSiteUrl: TEST_CONVEX_SITE_URL,
          ...(options.refresh ? { refresh: true } : {}),
          rev: options.rev ?? 1,
        },
        step: fakeStep.step,
      },
      testDeps(env, convex.fetcher, ops.ops)
    );
  return { convex, fakeStep, ops, run };
};

/** Each stage's writes, in order, e.g. classify: in_progress → completed. */
const stageHistory = (
  writes: Array<{ stage: string; status: string }>,
  stage: string
) => writes.filter((write) => write.stage === stage).map((w) => w.status);

const reported = (convex: ReturnType<typeof createCardConvex>) =>
  convex.callsTo("workflowDispatch:complete").map((call) => call.args.status);

describe("card processing", () => {
  test("a text card: classify, then metadata, each marked in progress first", async () => {
    const card = makeCard({ content: "Notes about typography" });
    const { convex, fakeStep, ops, run } = setup(card, {
      "generate-text-metadata": textMetadataAnswer(["type", "fonts"]),
    });

    const result = await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "classify",
      "generate metadata",
      "emit completion",
      "report complete",
    ]);
    expect(stageHistory(convex.stageWrites, "classify")).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(stageHistory(convex.stageWrites, "metadata")).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(card.aiTags).toEqual(["type", "fonts"]);
    expect(ops.opsCalled()).toEqual([
      "decide-card-type",
      "generate-text-metadata",
    ]);
    expect(result).toMatchObject({
      classification: { type: "text" },
      metadata: { aiTagsCount: 2, mode: "completed" },
      mode: "completed",
    });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("every card-processing write carries the run's revision", async () => {
    const { convex, run } = setup(makeCard({ content: "Some text" }), {
      "generate-text-metadata": textMetadataAnswer(),
    });
    await run();
    const writes = convex.calls.filter(
      (call) =>
        call.kind === "mutation" && call.name !== "workflowDispatch:complete"
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.guard).toEqual({ cardId: CARD_ID, rev: 1 });
    }
  });

  test("a link card: metadata, categorization, AI metadata, then its screenshot", async () => {
    const card = makeCard({
      content: "https://example.com/article",
      processingStatus: {
        categorize: { status: "pending" },
        classify: { status: "pending" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/article",
    });
    const page = await linkPage();
    const { convex, fakeStep, ops, run } = setup(card, {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "extract-image-text": { data: { text: "A good article\nRead more" } },
      "fetch-link-page": page,
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "classify",
      "fetch link metadata",
      "categorize",
      "generate metadata",
      "capture screenshot",
      "read link image text",
      "emit completion",
      "report complete",
    ]);
    // The screenshot's text, for search.
    const screenshotKey = (
      card.metadata as { linkPreview: { screenshotStorageKey: string } }
    ).linkPreview.screenshotStorageKey;
    expect(
      ops.calls
        .filter((call) => call.op === "extract-image-text")
        .map((call) => call.params.sourceKey)
    ).toEqual([screenshotKey]);
    expect(card.aiOcrText).toBe("A good article\nRead more");
    expect(card.ocrCheckedAt).toEqual(expect.any(Number));
    expect(
      (card.metadata as { linkPreview: { title: string } }).linkPreview.title
    ).toBe("A good article");
    expect(stageHistory(convex.stageWrites, "categorize")).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(stageHistory(convex.stageWrites, "screenshot")).toEqual([
      "in_progress",
      "completed",
    ]);
    // The page is read once per step from the op (cached for a day there):
    // the preview, the JSON-LD and the screenshot HTML.
    expect(ops.opsCalled().filter((op) => op === "fetch-link-page")).toEqual([
      "fetch-link-page",
      "fetch-link-page",
      "fetch-link-page",
    ]);
    const capture = ops.calls.find((call) => call.op === "capture-screenshot");
    expect(capture?.params.htmlGzipBase64).toBe(page.data.htmlGzipBase64);
    expect(convex.callsTo("linkMetadata:updateCardScreenshot")).toHaveLength(1);
  });

  const linkCard = () =>
    makeCard({
      content: "https://example.com/article",
      processingStatus: {
        categorize: { status: "pending" },
        classify: { status: "pending" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/article",
    });

  const EPISODE_HTML = `<html><head>
  <title>Episode 42</title>
  <meta property="og:title" content="Episode 42: Leaves">
  <meta property="og:audio" content="https://audio.example.com/42.mp3">
</head><body></body></html>`;

  const podcastRun = async (step?: Parameters<typeof createFakeStep>[0]) => {
    const card = makeCard({
      content: "https://example.com/podcast/episode-42",
      processingStatus: {
        categorize: { status: "pending" },
        classify: { status: "pending" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/podcast/episode-42",
    });
    const ctx = setup(
      card,
      {
        "capture-screenshot": { data: { height: 900, width: 1440 } },
        "extract-image-text": { data: { text: "" } },
        "fetch-link-page": {
          data: {
            charset: "utf-8",
            fetched: true,
            htmlGzipBase64: await gzipBase64(EPISODE_HTML),
            pageUrl: "https://example.com/podcast/episode-42",
            selectors: buildSelectorResultsFromHtml(
              EPISODE_HTML,
              SCRAPE_ELEMENTS
            ),
            source: "static",
          },
        },
        "generate-link-metadata": textMetadataAnswer(["podcast"]),
      },
      { step }
    );
    return { card, ...ctx };
  };

  test("a podcast link's transcript comes after the run has completed", async () => {
    const { card, convex, fakeStep, run } = await podcastRun();

    const result = await run();

    expect(
      (card.metadata as { linkCategory: { category: string } }).linkCategory
        .category
    ).toBe("podcast");
    expect(fakeStep.names()).toEqual([
      "load card",
      "classify",
      "fetch link metadata",
      "categorize",
      "generate metadata",
      "capture screenshot",
      "read link image text",
      "emit completion",
      "transcribe podcast",
      "report complete",
    ]);
    // No stage waits on it: the card was complete before it started.
    expect(
      Object.values(card.processingStatus ?? {}).map((stage) => stage.status)
    ).not.toContain("in_progress");
    expect(result).toMatchObject({ mode: "completed" });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a podcast transcript that fails for good leaves the run completed", async () => {
    const { convex, fakeStep, run } = await podcastRun({
      failures: {
        "transcribe podcast": {
          error: new Error("renderer unavailable"),
          times: 5,
        },
      },
    });

    const result = await run();

    expect(fakeStep.records.at(-2)).toMatchObject({
      name: "transcribe podcast",
      outcome: "error",
    });
    expect(result).toMatchObject({ mode: "completed" });
    expect(reported(convex)).toEqual(["complete"]);
  });

  const finalError = (message: string) =>
    Object.assign(new Error(message), { name: "NonRetryableError" });

  test("a screenshot that fails for good is recorded failed and the run completes", async () => {
    const card = linkCard();
    const { convex, run } = setup(card, {
      "capture-screenshot": { throws: finalError("renderer_refused") },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    const result = await run();

    expect(result).toMatchObject({ mode: "completed" });
    expect(card.processingStatus?.screenshot).toMatchObject({
      error: "screenshot_error",
      status: "failed",
    });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("link image text that fails leaves the screenshot completed and the card unread", async () => {
    const card = linkCard();
    const { run } = setup(card, {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "extract-image-text": {
        throws: new Error("files_worker_ai: rate limit reached 429"),
      },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    const result = await run();

    expect(result).toMatchObject({ mode: "completed" });
    expect(card.processingStatus?.screenshot?.status).toBe("completed");
    expect(card.ocrCheckedAt).toBeUndefined();
  });

  test("an edit while the screenshot fails still ends the run as replaced", async () => {
    const card = linkCard();
    const { convex, run } = setup(card, {
      "capture-screenshot": () => {
        card.processingRev = 2;
        return { throws: finalError("renderer_refused") };
      },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    expect(await run()).toEqual({ mode: "skipped", reason: "superseded" });
    expect(card.processingStatus?.screenshot?.status).toBe("in_progress");
    expect(reported(convex)).toEqual(["complete"]);
  });

  const refreshedLink = () =>
    makeCard({
      ...linkCard(),
      metadata: {
        linkPreview: {
          status: "success",
          title: "Stored title",
          url: "https://example.com/article",
        },
      },
    });

  test("a refresh fetches the link preview again even when the stored one worked", async () => {
    const card = refreshedLink();
    const { convex, run } = setup(
      card,
      {
        "capture-screenshot": { data: { height: 900, width: 1440 } },
        "fetch-link-page": await linkPage(),
        "generate-link-metadata": textMetadataAnswer(["article"]),
      },
      { refresh: true }
    );

    expect(await run()).toMatchObject({ mode: "completed" });
    expect(
      (card.metadata as { linkPreview: { title: string } }).linkPreview.title
    ).toBe("A good article");
    expect(
      convex.callsTo("linkMetadata:updateCardMetadata")[0]?.args
    ).toMatchObject({ refresh: true, status: "completed" });
  });

  test("a refresh that can't read the page keeps the stored preview and finishes", async () => {
    const card = refreshedLink();
    const { convex, fakeStep, ops, run } = setup(
      card,
      {
        "capture-screenshot": { data: { height: 900, width: 1440 } },
        "fetch-link-page": { fallback: "RENDERER_UNAVAILABLE" },
        "generate-link-metadata": textMetadataAnswer(["article"]),
      },
      { refresh: true }
    );

    expect(await run()).toMatchObject({ mode: "completed" });
    // The preview fetch was retried before giving up.
    expect(
      ops.opsCalled().filter((op) => op === "fetch-link-page").length
    ).toBeGreaterThan(2);
    expect(fakeStep.names()).toContain("keep link preview after refresh");
    expect(card.metadataStatus).toBe("completed");
    expect(
      (card.metadata as { linkPreview: { title: string } }).linkPreview.title
    ).toBe("Stored title");
    // The run went on past the preview to categorize the link.
    expect(card.processingStatus?.categorize?.status).toBe("completed");
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("an automatic run that can't read the page fails as before", async () => {
    const card = linkCard();
    const { fakeStep, run } = setup(card, {
      "fetch-link-page": { fallback: "RENDERER_UNAVAILABLE" },
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    await expect(run()).rejects.toThrow("workflow:linkMetadata:retryable:");
    expect(fakeStep.names()).not.toContain("keep link preview after refresh");
  });

  test("a metadata-only run regenerates the AI metadata and nothing else", async () => {
    const card = makeCard({
      content: "https://example.com/article",
      metadata: { linkPreview: { status: "success", title: "Kept" } },
      processingStatus: {
        categorize: { status: "completed" },
        classify: { confidence: 0.9, status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
        screenshot: { status: "completed" },
      },
      type: "link",
      url: "https://example.com/article",
    });
    const convex = createCardConvex(card);
    const ops = createFakeOps({
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });
    const fakeStep = createFakeStep();
    const env = testEnv();

    await runCardProcessing(
      {
        env,
        instanceId: `card-${CARD_ID}-1`,
        params: {
          cardId: CARD_ID,
          convexSiteUrl: TEST_CONVEX_SITE_URL,
          metadataOnly: true,
          rev: 1,
        },
        step: fakeStep.step,
      },
      testDeps(env, convex.fetcher, ops.ops)
    );

    expect(fakeStep.names()).toEqual([
      "load card",
      "generate metadata",
      "report complete",
    ]);
    expect(ops.opsCalled()).toEqual(["generate-link-metadata"]);
    expect(card.aiTags).toEqual(["article"]);
    expect(
      convex.stageWrites.filter((write) => write.stage !== "metadata")
    ).toEqual([]);
  });

  test("an image card: renderables, palette, then metadata, one after another", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.png",
      fileMetadata: {
        fileName: "a.png",
        height: 600,
        mimeType: "image/png",
        width: 800,
      },
      processingStatus: {
        categorize: { status: "completed" },
        classify: { confidence: 0.97, status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "pending" },
      },
      type: "image",
    });
    const { convex, fakeStep, run } = setup(card, {
      "analyze-image": {
        data: { height: 600, palette: ["#112233"], width: 800 },
      },
      "generate-image-metadata": {
        data: { summary: "A photo", tags: ["sky"] },
      },
    });

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "generate renderables",
      "extract palette",
      "generate metadata",
      "emit completion",
      "report complete",
    ]);
    expect(stageHistory(convex.stageWrites, "renderables")).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(card.aiSummary).toBe("A photo");
  });

  test("a video card: its thumbnail before metadata, which reads it", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.mp4",
      fileMetadata: { fileName: "a.mp4", mimeType: "video/mp4" },
      processingStatus: {
        classify: { status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "pending" },
      },
      type: "video",
    });
    const { fakeStep, ops, run } = setup(card, {
      "extract-video-frame": {
        data: {
          durationSeconds: 12,
          facts: null,
          originalHeight: 720,
          originalWidth: 1280,
          palette: [],
          scrub: null,
        },
      },
      "generate-image-metadata": {
        data: { summary: "A clip", tags: ["clip"] },
      },
      "process-audio": {
        data: {
          facts: { durationSeconds: 12 },
          peaks: null,
          transcript: { reason: "no_audio", status: "skipped" },
        },
      },
    });

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "generate renderables",
      "generate metadata",
      "emit completion",
      "report complete",
    ]);
    const frame = ops.calls.find((call) => call.op === "extract-video-frame");
    const metadata = ops.calls.find(
      (call) => call.op === "generate-image-metadata"
    );
    expect(metadata?.params.sourceKey).toBe(frame?.params.destinationKey);
  });

  test("an audio card: its transcript becomes the metadata", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.m4a",
      fileMetadata: { fileName: "a.m4a", mimeType: "audio/mp4" },
      type: "audio",
    });
    const { fakeStep, run } = setup(card, {
      "generate-text-metadata": textMetadataAnswer(["podcast"]),
      "process-audio": {
        data: {
          facts: { durationSeconds: 95 },
          peaks: null,
          transcript: {
            status: "completed",
            text: "Welcome to the show about gardens.",
          },
        },
      },
    });

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "classify",
      "generate metadata",
      "emit completion",
      "report complete",
    ]);
    expect(card.aiTranscript).toBe("Welcome to the show about gardens.");
    expect(card.aiTags).toEqual(["podcast"]);
  });

  test("a document card: metadata and renderables run side by side", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.pdf",
      fileMetadata: { fileName: "a.pdf", mimeType: "application/pdf" },
      processingStatus: {
        classify: { status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "pending" },
      },
      type: "document",
    });
    let renderStarted: () => void = () => undefined;
    const rendering = new Promise<void>((resolve) => {
      renderStarted = resolve;
    });
    let metadataStarted: () => void = () => undefined;
    const generating = new Promise<void>((resolve) => {
      metadataStarted = resolve;
    });
    // Each side waits until the other has started: run one after the
    // other, they would never finish.
    const answers = createFakeOps({
      "generate-text-metadata": textMetadataAnswer(["report"]),
      inspect: {
        data: {
          facts: { pageCount: 1 },
          text: "Quarterly report for the freight team",
        },
      },
      "render-pdf-thumbnail": { data: { height: 1100, width: 850 } },
    });
    const gatedOps: typeof answers.ops = async (spec) => {
      if (spec.op === "generate-text-metadata") {
        metadataStarted();
        await rendering;
      }
      if (spec.op === "render-pdf-thumbnail") {
        renderStarted();
        await generating;
      }
      return await answers.ops(spec);
    };
    const convex = createCardConvex(card);
    const fakeStep = createFakeStep();
    const env = testEnv();
    await runCardProcessing(
      {
        env,
        instanceId: `card-${CARD_ID}-1`,
        params: {
          cardId: CARD_ID,
          convexSiteUrl: TEST_CONVEX_SITE_URL,
          rev: 1,
        },
        step: fakeStep.step,
      },
      testDeps(env, convex.fetcher, gatedOps)
    );

    expect(fakeStep.names()).toContain("generate metadata");
    expect(fakeStep.names()).toContain("generate renderables");
    expect(card.thumbnailKey).toBeString();
    expect(card.aiTags).toEqual(["report"]);
    expect(convex.callsTo("card/documentText:saveDocumentText")).toHaveLength(
      1
    );
  });

  test("renderables that exhaust their retries fail the stage and the run goes on", async () => {
    const card = makeCard({
      fileKey: "users/x/cards/c/file/a.pdf",
      fileMetadata: { fileName: "a.pdf", mimeType: "application/pdf" },
      processingStatus: {
        classify: { status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "pending" },
      },
      type: "document",
    });
    const { convex, fakeStep, run } = setup(card, {
      "generate-text-metadata": textMetadataAnswer(),
      inspect: { data: { text: "" } },
      "render-pdf-thumbnail": {
        throws: new Error("files_worker_error:RENDERER_UNAVAILABLE:503:x"),
      },
    });

    await run();

    const renderables = fakeStep.records.find(
      (record) => record.name === "generate renderables"
    );
    expect(renderables).toEqual({
      attempts: 4,
      name: "generate renderables",
      outcome: "error",
    });
    expect(
      convex.callsTo(
        "workflows/steps/renderables/mutations:markCardRenderablesFailed"
      )
    ).toHaveLength(1);
    expect(card.processingStatus?.renderables).toMatchObject({
      error: "thumbnail_generation_failed",
      status: "failed",
    });
    expect(card.processingStatus?.metadata?.status).toBe("completed");
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("Workers AI capacity retries the metadata step 30 s longer each time", async () => {
    let calls = 0;
    const card = makeCard({ content: "Busy day" });
    const { fakeStep, run } = setup(card, {
      "generate-text-metadata": () => {
        calls += 1;
        return calls <= 2
          ? { throws: new Error("files_worker_ai: rate limit reached 429") }
          : textMetadataAnswer(["busy"]);
      },
    });

    await run();

    expect(
      fakeStep.delays.filter((delay) => delay.name === "generate metadata")
    ).toEqual([
      { attempt: 1, delay: "30 seconds", name: "generate metadata" },
      { attempt: 2, delay: "60 seconds", name: "generate metadata" },
    ]);
    expect(card.aiTags).toEqual(["busy"]);
  });

  test("capacity that outlasts the retries leaves the card to the backfill", async () => {
    const card = makeCard({ content: "Still busy" });
    const { fakeStep, run } = setup(card, {
      "generate-text-metadata": {
        throws: new Error("files_worker_ai: rate limit reached 429"),
      },
    });

    const result = await run();

    expect(
      fakeStep.records.find((record) => record.name === "generate metadata")
    ).toMatchObject({ attempts: AI_CAPACITY_RETRIES + 1, outcome: "ok" });
    expect(result).toMatchObject({ metadata: { mode: "deferred" } });
    expect(card.processingStatus?.metadata?.status).toBe("pending");
    expect(card.aiTags).toBeUndefined();
  });

  test("output that never validates defers at once, without retrying", async () => {
    const card = makeCard({ content: "Odd output" });
    const { fakeStep, run } = setup(card, {
      "generate-text-metadata": {
        throws: new Error("files_worker_ai: failed to validate JSON"),
      },
    });

    await run();

    expect(
      fakeStep.records.find((record) => record.name === "generate metadata")
    ).toMatchObject({ attempts: 1, outcome: "ok" });
    expect(card.processingStatus?.metadata?.status).toBe("pending");
  });

  test("AI paused from the console defers to the backfill", async () => {
    const card = makeCard({ content: "Paused" });
    const { ops, run } = setup(
      card,
      {},
      { handlers: { "adminAccess:getAiGate": () => "paused" } }
    );
    await run();
    expect(ops.calls).toEqual([]);
    expect(card.processingStatus?.metadata?.status).toBe("pending");
  });

  test("a run whose revision was replaced before it started writes nothing", async () => {
    const card = makeCard({ content: "Edited", processingRev: 2 });
    const { convex, fakeStep, run } = setup(card, {}, { rev: 1 });

    expect(await run()).toEqual({ mode: "skipped", reason: "superseded" });
    expect(fakeStep.names()).toEqual(["load card", "report complete"]);
    expect(
      convex.calls.filter(
        (call) =>
          call.kind === "mutation" && call.name !== "workflowDispatch:complete"
      )
    ).toEqual([]);
  });

  test("an edit during the run stops it before its next write", async () => {
    const card = makeCard({ content: "Being edited" });
    let gateReads = 0;
    const { convex, run } = setup(
      card,
      { "generate-text-metadata": textMetadataAnswer() },
      {
        handlers: {
          // The edit lands while the metadata step reads the AI gate (the
          // classify step's Clef review reads it first).
          "adminAccess:getAiGate": () => {
            gateReads += 1;
            if (gateReads === 2) {
              card.processingRev = 2;
            }
            return "allowed";
          },
        },
      }
    );

    expect(await run()).toEqual({ mode: "skipped", reason: "superseded" });
    expect(card.aiTags).toBeUndefined();
    expect(
      convex.callsTo("workflows/aiMetadata/mutations:updateCardAI")
    ).toHaveLength(1);
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a card deleted before the run starts is skipped", async () => {
    const { convex, run } = setup(null, {});
    expect(await run()).toEqual({ mode: "skipped", reason: "card_missing" });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a failing stage reports the run errored", async () => {
    const card = makeCard({
      content: "https://example.com/down",
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/down",
    });
    const { convex, run } = setup(card, {
      "fetch-link-page": {
        throws: new Error("files_worker_error:INTERNAL:500:x"),
      },
    });

    await expect(run()).rejects.toThrow("workflow:linkMetadata:retryable");
    expect(reported(convex)).toEqual(["errored"]);
  });
});
