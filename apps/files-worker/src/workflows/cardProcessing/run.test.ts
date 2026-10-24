import { describe, expect, test } from "bun:test";
import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import { buildSelectorResultsFromHtml } from "@teak/convex/linkMetadata/staticHtml";
import { AI_METADATA_PROMPT_VERSION, type FilesOp } from "@teak/files-protocol";
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
import { FakeBucket } from "../../test/testsupport";
import type { CardProcessingDeps } from "./context";
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

/** A link's saved copy, written where the step asked. */
const archivedPage = (params: Record<string, unknown>): OpAnswer => ({
  data: {
    bytes: 2048,
    kind: "full",
    pageUrl: params.url,
    source: params.snapshotKey ? "extension" : "server",
    storageKey: params.destinationKey,
    stored: true,
  },
});

/** A saved copy that isn't an article, unless a test says otherwise. */
const NOT_AN_ARTICLE: OpAnswer = {
  data: { kind: "none", reason: "too_short", wordCount: 40 },
};

const NO_DECISIONS: Partial<
  Record<FilesOp, OpAnswer | ((params: Record<string, unknown>) => OpAnswer)>
> = {
  "archive-page": archivedPage,
  "extract-article": NOT_AN_ARTICLE,
  "decide-card-type": clefAnswer(null),
  "decide-link-category": clefAnswer(null),
};

const setup = (
  card: FakeCard | null,
  answers: Partial<Record<FilesOp, OpAnswer | (() => OpAnswer)>>,
  options: {
    /** Podcast audio needs a bucket with multipart uploads. */
    bucket?: FakeBucket;
    deps?: Partial<CardProcessingDeps>;
    archiveOnly?: boolean;
    articleOnly?: boolean;
    handlers?: Parameters<typeof createCardConvex>[1];
    metadataOnly?: boolean;
    refresh?: boolean;
    rev?: number;
    step?: Parameters<typeof createFakeStep>[0];
  } = {}
) => {
  const convex = createCardConvex(card, options.handlers);
  const ops = createFakeOps({ ...NO_DECISIONS, ...answers });
  const fakeStep = createFakeStep(options.step);
  const env = testEnv(
    options.bucket ? { BUCKET: options.bucket as unknown as R2Bucket } : {}
  );
  const run = () =>
    runCardProcessing(
      {
        env,
        instanceId: `card-${CARD_ID}-${options.rev ?? 1}`,
        params: {
          cardId: CARD_ID,
          convexSiteUrl: TEST_CONVEX_SITE_URL,
          ...(options.archiveOnly ? { archiveOnly: true } : {}),
          ...(options.articleOnly ? { articleOnly: true } : {}),
          ...(options.metadataOnly ? { metadataOnly: true } : {}),
          ...(options.refresh ? { refresh: true } : {}),
          rev: options.rev ?? 1,
        },
        step: fakeStep.step,
      },
      testDeps(env, convex.fetcher, ops.ops, options.deps)
    );
  return { convex, fakeStep, ops, run };
};

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

  test("a Japanese note: its language is saved and is in the run's facts", async () => {
    const card = makeCard({ content: "来週、東京でデザイン展を見に行く。" });
    const { run } = setup(card, {
      "generate-text-metadata": {
        data: {
          language: "ja",
          summary: "東京のデザイン展についてのメモ。",
          tags: ["デザイン", "東京"],
          validationRetryCount: 0,
        },
      },
    });

    const result = await run();

    expect(card).toMatchObject({
      aiLanguage: "ja",
      aiTags: ["デザイン", "東京"],
    });
    expect(result).toMatchObject({
      metadata: {
        aiLanguage: "ja",
        aiPromptVersion: AI_METADATA_PROMPT_VERSION,
        mode: "completed",
      },
      mode: "completed",
    });
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
      "archive page",
      "extract article",
      "report complete",
    ]);
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

  const episodeAudio = (url: string) =>
    Promise.resolve(
      url === "https://audio.example.com/42.mp3"
        ? new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "audio/mpeg" },
          })
        : new Response("missing", { status: 404 })
    );

  const podcastRun = async (
    step?: Parameters<typeof createFakeStep>[0],
    processAudio: OpAnswer | (() => OpAnswer) = {
      data: {
        facts: { durationSeconds: 1800, hasAudio: true, hasVideo: false },
        transcript: { status: "completed", text: "Today, leaves." },
      },
    }
  ) => {
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
        "process-audio": processAudio,
      },
      {
        bucket: new FakeBucket(),
        deps: { podcastFetch: { episode: episodeAudio, feed: episodeAudio } },
        step,
      }
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
      "find podcast episode",
      "transcribe podcast",
      "archive page",
      "extract article",
      "report complete",
    ]);
    // No stage waits on it: the card was complete before it started.
    expect(
      Object.values(card.processingStatus ?? {}).map((stage) => stage.status)
    ).not.toContain("in_progress");
    expect(fakeStep.records.at(-4)).toMatchObject({
      name: "transcribe podcast",
      outcome: "ok",
    });
    expect(card.aiTranscript).toBe("Today, leaves.");
    expect(card.workflowArtifactKeys).toEqual([]);
    expect(result).toMatchObject({ mode: "completed" });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("an episode whose AI metadata waited is transcribed by the metadata-only run", async () => {
    const url = "https://example.com/podcast/episode-42";
    const card = makeCard({
      content: url,
      metadata: {
        linkCategory: { category: "podcast", fetchedAt: 1, sourceUrl: url },
        linkPreview: {
          raw: [
            {
              results: [
                {
                  attributes: [
                    {
                      name: "content",
                      value: "https://audio.example.com/42.mp3",
                    },
                  ],
                },
              ],
              selector: "meta[property='og:audio']",
            },
          ],
          status: "success",
          title: "Episode 42: Leaves",
        },
      },
      metadataStatus: "pending",
      type: "link",
      url,
    });
    const { fakeStep, run } = setup(
      card,
      {
        "generate-link-metadata": textMetadataAnswer(["podcast"]),
        "process-audio": {
          data: {
            facts: { durationSeconds: 1800, hasAudio: true, hasVideo: false },
            transcript: { status: "completed", text: "Today, leaves." },
          },
        },
      },
      {
        bucket: new FakeBucket(),
        deps: { podcastFetch: { episode: episodeAudio, feed: episodeAudio } },
        metadataOnly: true,
      }
    );

    expect(await run()).toMatchObject({ mode: "completed" });
    expect(fakeStep.names()).toContain("transcribe podcast");
    expect(card.aiTranscript).toBe("Today, leaves.");
  });

  test("a podcast transcript retried after a busy renderer takes one of the owner's hourly slots", async () => {
    let audioCalls = 0;
    const { card, convex, run } = await podcastRun(undefined, () => {
      audioCalls += 1;
      return audioCalls === 1
        ? { throws: new Error("files_worker_error:BUSY:503:x") }
        : {
            data: {
              facts: { durationSeconds: 1800, hasAudio: true, hasVideo: false },
              transcript: { status: "completed", text: "Today, leaves." },
            },
          };
    });

    expect(await run()).toMatchObject({ mode: "completed" });
    expect(audioCalls).toBe(2);
    expect(card.aiTranscript).toBe("Today, leaves.");
    expect(
      convex.callsTo(
        "workflows/steps/podcast/mutations:takePodcastTranscriptSlot"
      )
    ).toHaveLength(1);
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

    expect(fakeStep.records.at(-4)).toMatchObject({
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
    expect(
      ops.opsCalled().filter((op) => op === "fetch-link-page").length
    ).toBeGreaterThan(2);
    expect(fakeStep.names()).toContain("keep link preview after refresh");
    expect(card.metadataStatus).toBe("completed");
    expect(
      (card.metadata as { linkPreview: { title: string } }).linkPreview.title
    ).toBe("Stored title");
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

  test("a link to a PDF keeps a failed preview and the run still categorizes it", async () => {
    const card = linkCard();
    const { convex, ops, run } = setup(card, {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "fetch-link-page": {
        data: {
          contentType: "application/pdf",
          fetched: false,
          reason: "unsupported_type",
        },
      },
      "generate-link-metadata": textMetadataAnswer(["paper"]),
    });

    expect(await run()).toMatchObject({ mode: "completed" });
    expect(card.metadataStatus).toBe("failed");
    expect(card.processingStatus?.categorize?.status).toBe("completed");
    expect(card.processingStatus?.metadata?.status).toBe("completed");
    expect(reported(convex)).toEqual(["complete"]);
    // One fetch for the preview, one for structured data: no retries.
    expect(
      ops.opsCalled().filter((op) => op === "fetch-link-page")
    ).toHaveLength(2);
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
    const { convex, run } = setup(card, {
      "generate-text-metadata": () => {
        card.processingRev = 2;
        return textMetadataAnswer();
      },
    });

    expect(await run()).toEqual({ mode: "skipped", reason: "superseded" });
    expect(card.aiTags).toBeUndefined();
    expect(
      convex.callsTo("workflows/aiMetadata/mutations:updateCardAI")
    ).toHaveLength(1);
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a link run asks Convex for the AI gate once across its AI steps", async () => {
    const { convex, ops, run } = setup(linkCard(), {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "extract-image-text": { data: { text: "A good article" } },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    await run();

    expect(ops.opsCalled()).toEqual(
      expect.arrayContaining([
        "decide-link-category",
        "generate-link-metadata",
        "extract-image-text",
      ])
    );
    expect(convex.callsTo("adminAccess:getAiGate")).toHaveLength(1);
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

describe("archive page", () => {
  const ARCHIVED_AT = Date.UTC(2026, 9, 1);
  const SNAPSHOT_KEY = `users/x/cards/upload-pending-v2/page-snapshot/${"a".repeat(8)}`;

  /** A link whose AI processing is done, so only the archive is left. */
  const processedLink = (fields: Partial<FakeCard> = {}) =>
    makeCard({
      content: "https://example.com/article",
      metadata: {
        linkPreview: {
          status: "success",
          title: "A good article",
          url: "https://example.com/article",
        },
      },
      metadataStatus: "completed",
      processingStatus: {
        archive: { status: "pending" },
        categorize: { status: "completed" },
        classify: { status: "completed" },
        metadata: { status: "completed" },
        renderables: { status: "completed" },
      },
      type: "link",
      url: "https://example.com/article",
      ...fields,
    });

  const archiveCalls = (ops: ReturnType<typeof setup>["ops"]) =>
    ops.calls.filter((call) => call.op === "archive-page");

  test("is a link's last step, and records the copy under a key registered first", async () => {
    const card = makeCard({
      content: "https://example.com/article",
      processingStatus: {
        archive: { status: "pending" },
        categorize: { status: "pending" },
        classify: { status: "pending" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/article",
    });
    const { convex, fakeStep, ops, run } = setup(card, {
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "extract-image-text": { data: { text: "" } },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    await run();

    expect(fakeStep.names().slice(-3)).toEqual([
      "archive page",
      "extract article",
      "report complete",
    ]);
    const [call] = archiveCalls(ops);
    const key = call?.params.destinationKey as string;
    expect(key).toEndWith("/page-archive/r1-archive.html");
    expect(call?.params).toMatchObject({ url: "https://example.com/article" });
    expect(call?.params.snapshotKey).toBeUndefined();
    expect(
      convex
        .callsTo("storage/ownership:registerObject")
        .map((registered) => registered.args.key)
    ).toContain(key);
    expect(card.pageArchive).toMatchObject({
      bytes: 2048,
      kind: "full",
      source: "server",
      sourceUrl: "https://example.com/article",
      storageKey: key,
    });
    expect(stageHistory(convex.stageWrites, "archive")).toEqual([
      "in_progress",
      "completed",
    ]);
  });

  test("an archive-only run loads the card, archives it and reads its article, nothing else", async () => {
    const card = processedLink();
    const { fakeStep, ops, run } = setup(card, {}, { archiveOnly: true });

    const result = await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "archive page",
      "extract article",
      "report complete",
    ]);
    expect(ops.opsCalled()).toEqual(["archive-page", "extract-article"]);
    expect(result).toEqual({
      archive: "full",
      article: "none",
      mode: "archive_only",
    });
    expect(card.processingStatus?.archive?.status).toBe("completed");
  });

  test("uses the extension's snapshot, then lets it go", async () => {
    const card = processedLink({
      pendingPageSnapshotAt: ARCHIVED_AT,
      pendingPageSnapshotKey: SNAPSHOT_KEY,
    });
    const { ops, run } = setup(card, {}, { archiveOnly: true });

    await run();

    expect(archiveCalls(ops)[0]?.params.snapshotKey).toBe(SNAPSHOT_KEY);
    expect(card.pageArchive).toMatchObject({ source: "extension" });
    expect(card.pendingPageSnapshotKey).toBeUndefined();
  });

  test.each([
    {
      name: "a card that already has a copy",
      card: () =>
        processedLink({
          pageArchive: {
            bytes: 1,
            capturedAt: ARCHIVED_AT,
            kind: "full",
            source: "server",
            sourceUrl: "https://example.com/article",
            storageKey: "users/x/cards/k/page-archive/r0-archive.html",
          },
        }),
    },
    {
      name: "a card in Trash",
      card: () => processedLink({ isDeleted: true }),
    },
    {
      name: "a note",
      card: () =>
        makeCard({ content: "Not a link", processingStatus: {}, type: "text" }),
    },
  ])("skips $name", async ({ card }) => {
    const target = card();
    const before = target.processingStatus?.archive;
    const { ops, run } = setup(target, {}, { archiveOnly: true });

    await run();

    expect(archiveCalls(ops)).toEqual([]);
    expect(target.processingStatus?.archive).toEqual(before);
  });

  test("Refresh details archives a page that already has a copy, fetching it fresh", async () => {
    const card = processedLink({
      pageArchive: {
        bytes: 1,
        capturedAt: ARCHIVED_AT,
        kind: "full",
        source: "server",
        sourceUrl: "https://example.com/article",
        storageKey: "users/x/cards/k/page-archive/r0-archive.html",
      },
      processingRev: 2,
    });
    const { ops, run } = setup(
      card,
      {},
      { archiveOnly: true, refresh: true, rev: 2 }
    );

    await run();

    expect(archiveCalls(ops)[0]?.params).toMatchObject({ fresh: true });
    expect(card.pageArchive?.storageKey).toEndWith(
      "/page-archive/r2-archive.html"
    );
  });

  test("a snapshot sent after the copy was taken is archived again", async () => {
    const card = processedLink({
      pageArchive: {
        bytes: 1,
        capturedAt: ARCHIVED_AT,
        kind: "full",
        source: "server",
        sourceUrl: "https://example.com/article",
        storageKey: "users/x/cards/k/page-archive/r0-archive.html",
      },
      pendingPageSnapshotAt: ARCHIVED_AT + 1,
      pendingPageSnapshotKey: SNAPSHOT_KEY,
    });
    const { ops, run } = setup(card, {}, { archiveOnly: true });

    await run();

    expect(archiveCalls(ops)).toHaveLength(1);
    expect(card.pageArchive).toMatchObject({ source: "extension" });
  });

  test("a page the fetcher can't have fails the stage at once, and the run completes", async () => {
    const card = processedLink();
    const { convex, ops, run } = setup(
      card,
      { "archive-page": { data: { reason: "blocked_url", stored: false } } },
      { archiveOnly: true }
    );

    await run();

    expect(archiveCalls(ops)).toHaveLength(1);
    expect(card.processingStatus?.archive).toMatchObject({
      error: "blocked_url",
      status: "failed",
    });
    expect(card.pageArchive).toBeUndefined();
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a busy fetcher is retried three times, then the stage fails and the card completes", async () => {
    const card = makeCard({
      content: "https://example.com/article",
      processingStatus: {
        archive: { status: "pending" },
        categorize: { status: "pending" },
        classify: { status: "pending" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
      metadataStatus: "pending",
      type: "link",
      url: "https://example.com/article",
    });
    const { convex, fakeStep, ops, run } = setup(card, {
      "archive-page": {
        throws: new Error("files_worker_error:RENDERER_UNAVAILABLE:503:wf"),
      },
      "capture-screenshot": { data: { height: 900, width: 1440 } },
      "extract-image-text": { data: { text: "" } },
      "fetch-link-page": await linkPage(),
      "generate-link-metadata": textMetadataAnswer(["article"]),
    });

    const result = await run();

    expect(archiveCalls(ops)).toHaveLength(4);
    expect(
      fakeStep.delays
        .filter((delay) => delay.name === "archive page")
        .map((delay) => delay.delay)
    ).toEqual(["30 seconds", "30 seconds", "30 seconds"]);
    // With no copy there is no article to wait for: its stage closes.
    expect(fakeStep.names().slice(-4)).toEqual([
      "archive page",
      "mark archive failed",
      "extract article",
      "report complete",
    ]);
    expect(card.processingStatus?.archive).toMatchObject({
      error: "unreachable",
      status: "failed",
    });
    expect(card.processingStatus?.metadata?.status).toBe("completed");
    expect(result).toMatchObject({ mode: "completed" });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a card edited while it archives: the copy is deleted and the run ends as replaced", async () => {
    const card = processedLink();
    const { ops, run } = setup(
      card,
      {
        "archive-page": (params) => {
          card.processingRev = 2;
          return archivedPage(params);
        },
        "delete-object": { data: { deleted: true } },
      },
      { archiveOnly: true }
    );

    const result = await run();

    const written = archiveCalls(ops)[0]?.params.destinationKey;
    expect(
      ops.calls
        .filter((call) => call.op === "delete-object")
        .map((call) => call.params.key)
    ).toEqual([written]);
    expect(card.pageArchive).toBeUndefined();
    expect(result).toEqual({ mode: "skipped", reason: "superseded" });
  });
});

describe("article steps", () => {
  const CAPTURED_AT = Date.UTC(2026, 9, 1);
  const ARCHIVE_KEY = "users/x/cards/k/page-archive/r1-archive.html";

  /** A link whose copy is saved, so only its article is left. */
  const archivedLink = (fields: Partial<FakeCard> = {}) =>
    makeCard({
      content: "https://example.com/article",
      metadata: {
        linkPreview: {
          status: "success",
          title: "A good article",
          url: "https://example.com/article",
        },
      },
      metadataStatus: "completed",
      aiSummary: "From the page's details",
      aiTags: ["kept"],
      pageArchive: {
        bytes: 2048,
        capturedAt: CAPTURED_AT,
        kind: "full",
        source: "server",
        sourceUrl: "https://example.com/article",
        storageKey: ARCHIVE_KEY,
      },
      processingStatus: {
        archive: { status: "completed" },
        article: { status: "pending" },
        categorize: { status: "completed" },
        classify: { status: "completed" },
        metadata: { status: "completed" },
        renderables: { status: "completed" },
      },
      type: "link",
      url: "https://example.com/article",
      ...fields,
    });

  const MARKDOWN = "## Gardens\n\nPlant in spring. ![A rose](teak-image:0)";

  const anArticle = (wordCount: number): OpAnswer => ({
    data: {
      byline: "Ada",
      images: [
        {
          base64: btoa("WEBP-BYTES"),
          bytes: 10,
          contentType: "image/webp",
        },
      ],
      kind: "article",
      lang: "en",
      markdown: MARKDOWN,
      title: "Gardens",
      truncated: false,
      wordCount,
    },
  });

  test("an article-only run extracts the article, stores it by content and summarizes it", async () => {
    const card = archivedLink();
    const bucket = new FakeBucket();
    const { convex, fakeStep, ops, run } = setup(
      card,
      {
        "extract-article": anArticle(640),
        "generate-link-metadata": textMetadataAnswer(
          ["new", "tags"],
          "From the article"
        ),
      },
      { articleOnly: true, bucket }
    );

    const result = await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "extract article",
      "summarize article",
      "report complete",
    ]);
    expect(result).toEqual({ article: "article", mode: "article_only" });
    expect(ops.calls[0]).toEqual({
      op: "extract-article",
      params: {
        archiveKey: ARCHIVE_KEY,
        pageUrl: "https://example.com/article",
      },
    });
    const [saved] = convex.callsTo("card/articleText:saveArticleText");
    const textKey = saved?.args.textKey as string;
    expect(textKey).toMatch(
      /\/k57card0+1\/article-text\/r1-[a-f0-9]{64}\.md$/u
    );
    const article = saved?.args.article as { imageKeys: string[] };
    const imageKeys = article.imageKeys;
    expect(imageKeys).toHaveLength(1);
    expect(imageKeys[0]).toMatch(/\/article-image\/r1-[a-f0-9]{64}\.webp$/u);
    expect(saved?.args).toMatchObject({
      article: { byline: "Ada", lang: "en", title: "Gardens", wordCount: 640 },
      charCount: Array.from("Gardens\n\nPlant in spring. A rose").length,
      searchText: "Gardens\n\nPlant in spring. A rose",
      truncated: false,
    });
    // Every object is registered to the account before it is written.
    const registered = convex
      .callsTo("storage/ownership:registerObject")
      .map((call) => call.args.key);
    expect(registered).toEqual([imageKeys[0], textKey]);
    expect(bucket.puts.map((put) => put.key)).toEqual([imageKeys[0], textKey]);
    expect(new TextDecoder().decode(bucket.objects.get(textKey)?.bytes)).toBe(
      MARKDOWN
    );
    expect(bucket.puts[0]?.httpMetadata).toEqual({
      contentType: "image/webp",
    });
    // The summary is written again from the article; the tags stay.
    expect(card.aiSummary).toBe("From the article");
    expect(card.aiTags).toEqual(["kept"]);
    const prompt = String(
      ops.calls.find((call) => call.op === "generate-link-metadata")?.params
        .prompt
    );
    expect(prompt).toContain("Article: Gardens");
    expect(stageHistory(convex.stageWrites, "article")).toEqual([
      "in_progress",
      "completed",
    ]);
  });

  test("an article under 200 words keeps the summary it has", async () => {
    const card = archivedLink();
    const { fakeStep, ops, run } = setup(
      card,
      { "extract-article": anArticle(150) },
      { articleOnly: true }
    );

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "extract article",
      "report complete",
    ]);
    expect(ops.opsCalled()).toEqual(["extract-article"]);
    expect(card.aiSummary).toBe("From the page's details");
  });

  test("an account with AI turned off keeps its summary", async () => {
    const card = archivedLink();
    const { ops, run } = setup(
      card,
      { "extract-article": anArticle(640) },
      {
        articleOnly: true,
        handlers: { "adminAccess:getAiGate": () => "user_disabled" },
      }
    );

    await run();

    expect(ops.opsCalled()).toEqual(["extract-article"]);
    expect(card.aiSummary).toBe("From the page's details");
  });

  test("the article comes after the copy in a whole run", async () => {
    const card = archivedLink({
      pageArchive: undefined,
      processingStatus: {
        archive: { status: "pending" },
        article: { status: "pending" },
        categorize: { status: "completed" },
        classify: { status: "completed" },
        metadata: { status: "completed" },
        renderables: { status: "completed" },
      },
    });
    const { fakeStep, ops, run } = setup(
      card,
      { "extract-article": anArticle(150) },
      { archiveOnly: true }
    );

    const result = await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "archive page",
      "extract article",
      "report complete",
    ]);
    // It reads the copy the run just saved.
    const extractCall = ops.calls.find((call) => call.op === "extract-article");
    expect(extractCall?.params.archiveKey).toEndWith(
      "/page-archive/r1-archive.html"
    );
    expect(result).toEqual({
      archive: "full",
      article: "article",
      mode: "archive_only",
    });
  });

  test("a new run keeps the keys of content it already stored, and names new content for itself", async () => {
    const card = archivedLink({ processingRev: 1 });
    const bucket = new FakeBucket();
    const keysOf = (convex: ReturnType<typeof setup>["convex"]) => {
      const [saved] = convex.callsTo("card/articleText:saveArticleText");
      return {
        image: (saved?.args.article as { imageKeys?: string[] } | undefined)
          ?.imageKeys?.[0],
        text: saved?.args.textKey as string,
      };
    };
    const first = setup(
      card,
      { "extract-article": anArticle(640) },
      { articleOnly: true, bucket }
    );
    await first.run();
    const stored = keysOf(first.convex);

    card.processingRev = 2;
    const same = setup(
      card,
      { "extract-article": anArticle(640) },
      { articleOnly: true, bucket, refresh: true, rev: 2 }
    );
    await same.run();
    expect(keysOf(same.convex)).toEqual(stored);
    expect(bucket.puts).toHaveLength(2);

    card.processingRev = 3;
    const changed = anArticle(640) as { data: { markdown: string } };
    changed.data.markdown = "## Gardens\n\nPlant in autumn.";
    const edited = setup(
      card,
      { "extract-article": changed as OpAnswer },
      { articleOnly: true, bucket, refresh: true, rev: 3 }
    );
    await edited.run();
    const next = keysOf(edited.convex);
    expect(next.image).toBe(stored.image);
    expect(next.text).not.toBe(stored.text);
    expect(next.text).toMatch(/\/article-text\/r3-[a-f0-9]{64}\.md$/u);
  });

  test("a page that isn't an article is recorded as none", async () => {
    const card = archivedLink();
    const { convex, run } = setup(card, {}, { articleOnly: true });

    const result = await run();

    expect(result).toEqual({ article: "none", mode: "article_only" });
    expect(convex.callsTo("card/articleText:recordNoArticle")[0]?.args).toEqual(
      { cardId: CARD_ID, wordCount: 40 }
    );
    expect(card.article).toMatchObject({ status: "none" });
  });

  test("an article made from this copy is kept, unless Refresh details asked again", async () => {
    const extracted = {
      extractedAt: CAPTURED_AT + 1000,
      imageKeys: [],
      readingMinutes: 3,
      status: "ready",
      textKey: "users/x/cards/k/article-text/old.md",
      wordCount: 640,
    };
    const kept = archivedLink({ article: extracted });
    const first = setup(kept, {}, { articleOnly: true });
    expect(await first.run()).toEqual({
      article: "skipped:already_extracted",
      mode: "article_only",
    });
    expect(first.ops.opsCalled()).toEqual([]);

    const refreshed = archivedLink({ article: extracted });
    const second = setup(
      refreshed,
      { "extract-article": anArticle(150) },
      { articleOnly: true, refresh: true }
    );
    expect(await second.run()).toEqual({
      article: "article",
      mode: "article_only",
    });

    // An article older than the copy is taken again.
    const stale = archivedLink({
      article: { ...extracted, extractedAt: CAPTURED_AT - 1 },
    });
    const third = setup(stale, {}, { articleOnly: true });
    await third.run();
    expect(third.ops.opsCalled()).toEqual(["extract-article"]);
  });

  test("a highlighted link keeps its copy and article on Refresh details and on a re-save", async () => {
    const extracted = {
      extractedAt: CAPTURED_AT + 1000,
      imageKeys: [],
      readingMinutes: 3,
      status: "ready",
      textKey: "users/x/cards/k/article-text/r1-old.md",
      wordCount: 640,
    };
    const refreshed = archivedLink({
      article: extracted,
      hasHighlights: true,
      highlightCount: 2,
      processingRev: 2,
    });
    const refresh = setup(
      refreshed,
      {},
      { archiveOnly: true, refresh: true, rev: 2 }
    );
    expect(await refresh.run()).toEqual({
      archive: "skipped:frozen",
      article: "skipped:frozen",
      mode: "archive_only",
    });
    expect(refresh.ops.opsCalled()).toEqual([]);
    expect(refreshed.pageArchive).toMatchObject({ storageKey: ARCHIVE_KEY });
    expect(refreshed.article).toEqual(extracted);

    // The extension sent the page again after the copy was taken.
    const resaved = archivedLink({
      article: extracted,
      hasHighlights: true,
      highlightCount: 1,
      pendingPageSnapshotAt: CAPTURED_AT + 5000,
      pendingPageSnapshotKey: `users/x/cards/upload-pending-v2/page-snapshot/${"b".repeat(8)}`,
    });
    const resave = setup(resaved, {}, { archiveOnly: true });
    expect(await resave.run()).toEqual({
      archive: "skipped:frozen",
      article: "skipped:frozen",
      mode: "archive_only",
    });
    expect(resave.ops.opsCalled()).toEqual([]);
    expect(resaved.pageArchive).toMatchObject({ storageKey: ARCHIVE_KEY });

    // Without highlights, the same refresh takes both again.
    const plain = archivedLink({ article: extracted, processingRev: 2 });
    const unfrozen = setup(
      plain,
      { "extract-article": anArticle(150) },
      { archiveOnly: true, refresh: true, rev: 2 }
    );
    await unfrozen.run();
    expect(unfrozen.ops.opsCalled()).toContain("archive-page");
  });

  test("an imported highlight's link still gets its first copy and article", async () => {
    const card = archivedLink({
      hasHighlights: true,
      highlightCount: 1,
      pageArchive: undefined,
      processingStatus: {
        archive: { status: "pending" },
        article: { status: "pending" },
        categorize: { status: "completed" },
        classify: { status: "completed" },
        metadata: { status: "completed" },
        renderables: { status: "completed" },
      },
    });
    const { ops, run } = setup(
      card,
      { "extract-article": anArticle(150) },
      { archiveOnly: true }
    );
    expect(await run()).toMatchObject({ article: "article" });
    expect(ops.opsCalled()).toEqual(["archive-page", "extract-article"]);
  });

  test("a link without a saved copy closes its article stage", async () => {
    const card = archivedLink({ pageArchive: undefined });
    const { convex, ops, run } = setup(card, {}, { articleOnly: true });

    expect(await run()).toEqual({
      article: "skipped:no_archive",
      mode: "article_only",
    });
    expect(ops.opsCalled()).toEqual([]);
    expect(stageHistory(convex.stageWrites, "article")).toEqual(["completed"]);
  });

  test("an extraction that fails for good fails only the article stage", async () => {
    const card = archivedLink();
    const { convex, fakeStep, run } = setup(
      card,
      { "extract-article": { throws: new Error("isolate busy") } },
      { articleOnly: true }
    );

    const result = await run();

    expect(fakeStep.names().slice(-3)).toEqual([
      "extract article",
      "mark article failed",
      "report complete",
    ]);
    expect(
      fakeStep.delays
        .filter((delay) => delay.name === "extract article")
        .map((delay) => delay.delay)
    ).toEqual(["20 seconds", "20 seconds"]);
    expect(card.processingStatus?.article).toMatchObject({
      error: "extract_error",
      status: "failed",
    });
    expect(result).toEqual({
      article: "failed:extract_error",
      mode: "article_only",
    });
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a saved copy gone from storage fails the stage without retrying", async () => {
    const card = archivedLink();
    const { run } = setup(
      card,
      { "extract-article": { data: { kind: "missing" } } },
      { articleOnly: true }
    );

    expect(await run()).toEqual({
      article: "failed:archive_missing",
      mode: "article_only",
    });
    expect(card.processingStatus?.article).toMatchObject({
      error: "archive_missing",
      status: "failed",
    });
  });

  test("a summary that fails leaves the article and the card done", async () => {
    const card = archivedLink();
    const { convex, run } = setup(
      card,
      {
        "extract-article": anArticle(640),
        "generate-link-metadata": { throws: new Error("model down") },
      },
      { articleOnly: true }
    );

    await run();

    expect(card.article).toMatchObject({ status: "ready" });
    expect(card.aiSummary).toBe("From the page's details");
    expect(reported(convex)).toEqual(["complete"]);
  });

  test("a metadata-only run summarizes a link's article again after its metadata", async () => {
    const card = archivedLink({
      article: {
        extractedAt: CAPTURED_AT + 1000,
        imageKeys: [],
        readingMinutes: 3,
        status: "ready",
        textKey: "users/x/cards/k/article-text/a.md",
        wordCount: 640,
      },
      processingStatus: {
        categorize: { status: "completed" },
        classify: { confidence: 0.9, status: "completed" },
        metadata: { status: "pending" },
        renderables: { status: "completed" },
      },
    });
    const bucket = new FakeBucket();
    await bucket.put("users/x/cards/k/article-text/a.md", "The article text.");
    const { fakeStep, run } = setup(
      card,
      {
        "generate-link-metadata": ((params: Record<string, unknown>) =>
          String(params.prompt).includes("Article: The article text.")
            ? textMetadataAnswer(["t"], "Article summary")
            : textMetadataAnswer(["t"], "Details summary")) as () => OpAnswer,
      },
      { bucket, metadataOnly: true }
    );

    await run();

    expect(fakeStep.names()).toEqual([
      "load card",
      "generate metadata",
      "summarize article",
      "report complete",
    ]);
    expect(card.aiSummary).toBe("Article summary");
  });
});
