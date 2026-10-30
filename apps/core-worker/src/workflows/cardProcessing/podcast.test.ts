import { beforeEach, describe, expect, test } from "bun:test";
import type { FilesOp } from "@teak/files-protocol";
import { freezeObject } from "../../deletionGate";
import {
  createCardConvex,
  createFakeOps,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
} from "../../test/cardProcessingKit";
import { FakeBucket, withObjectGates } from "../../test/testsupport";
import type { FilesOpCaller } from "../deps";
import { callFilesOp } from "../filesOps";
import { createWorkflowTelemetry } from "../telemetry";
import { isPodcastLink, transcribePodcastEpisode } from "./podcast";

// A podcast link's transcript: its audio found, streamed into a temporary
// object, transcribed and deleted, with the summary and tags rewritten from
// what is said. Whisper and the renderer are fakes; the link metadata op
// runs for real against a fake Workers AI.

const EPISODE_PAGE = "https://podcast.example.com/episodes/42";
const AUDIO = "https://audio.example.com/42.mp3";
const TRACK = "workflows/steps/podcast/mutations:trackPodcastAudio";
const UPDATE_AI = "workflows/aiMetadata/mutations:updateCardAI";

let aiPrompts: string[];
let aiFails: boolean;

const workersAi = {
  run: (_model: string, input: { messages: Array<{ content: string }> }) => {
    aiPrompts.push(input.messages.at(-1)?.content ?? "");
    return Promise.resolve({
      response: aiFails
        ? "not json at all"
        : JSON.stringify({
            language: "en",
            summary: "An episode about leaves",
            tags: ["leaves", "botany"],
          }),
      usage: { completion_tokens: 30, prompt_tokens: 120 },
    });
  },
};

const transcribed = (text: string): OpAnswer => ({
  data: {
    facts: {
      container: "mp3",
      durationSeconds: 1800,
      hasAudio: true,
      hasVideo: false,
      height: null,
      videoCodec: null,
      width: null,
    },
    transcript: { status: "completed", text },
  },
});

const ogAudio = (url: string) => ({
  results: [{ attributes: [{ name: "content", value: url }] }],
  selector: "meta[property='og:audio']",
});

const podcastCard = (fields: Partial<FakeCard> = {}): Partial<FakeCard> => ({
  metadata: {
    linkCategory: {
      category: "podcast",
      fetchedAt: 1,
      sourceUrl: EPISODE_PAGE,
    },
    linkPreview: {
      raw: [ogAudio(AUDIO)],
      status: "success",
      title: "Episode 42: Leaves",
    },
  },
  type: "link",
  url: EPISODE_PAGE,
  ...fields,
});

const audioResponse = () =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { "content-length": "4", "content-type": "audio/mpeg" },
  });

const setup = (
  fields: Partial<FakeCard>,
  {
    handlers = {},
    network = (url: string) => (url === AUDIO ? audioResponse() : undefined),
    processAudio = transcribed("Today we talk about leaves."),
  }: {
    handlers?: Parameters<typeof createCardConvex>[1];
    network?: (url: string) => Response | undefined;
    processAudio?: OpAnswer | ((params: Record<string, unknown>) => OpAnswer);
  } = {}
) => {
  const card = makeCard(fields);
  const convex = createCardConvex(card, handlers);
  const fakes = createFakeOps({ "process-audio": processAudio });
  const bucket = new FakeBucket();
  const env = withObjectGates(
    testEnv({
      AI: workersAi as never,
      AI_USAGE: { writeDataPoint: () => undefined },
      BUCKET: bucket as never,
    })
  );
  const ops: FilesOpCaller = (spec) =>
    spec.op === ("generate-link-metadata" satisfies FilesOp)
      ? callFilesOp(env, spec)
      : fakes.ops(spec);
  const siteRequests: string[] = [];
  const site = (url: string) => {
    siteRequests.push(url);
    return Promise.resolve(
      network(url) ?? new Response("missing", { status: 404 })
    );
  };
  const job = testJob(
    env,
    testDeps(env, convex.fetcher, ops, {
      podcastFetch: { episode: site, feed: site },
    })
  );
  const run = () => transcribePodcastEpisode(job, createWorkflowTelemetry(env));
  const tracked = () =>
    convex.callsTo(TRACK).map((call) => ({
      key: String(call.args.key),
      stored: call.args.stored,
    }));
  return {
    bucket,
    card,
    convex,
    env,
    fakes,
    job,
    run,
    siteRequests,
    tracked,
  };
};

/** The temporary object was stored, then deleted and forgotten. */
const expectCleanedUp = (
  ctx: Pick<ReturnType<typeof setup>, "bucket" | "card" | "tracked">
) => {
  const calls = ctx.tracked();
  expect(calls.map((call) => call.stored)).toEqual([true, false]);
  expect(calls[0]?.key).toBe(calls[1]?.key);
  expect(calls[0]?.key).toContain("/podcast-audio/");
  expect(ctx.bucket.objects.size).toBe(0);
  expect(ctx.bucket.multipartUploads.size).toBe(0);
  expect(ctx.card.workflowArtifactKeys).toEqual([]);
};

beforeEach(() => {
  aiPrompts = [];
  aiFails = false;
});

describe("isPodcastLink", () => {
  test.each([
    ["link", "podcast", true],
    ["link", "music", false],
    ["audio", "podcast", false],
    [undefined, undefined, false],
  ])("%s / %s is %p", (type, category, expected) => {
    expect(isPodcastLink(type, category)).toBe(expected);
  });
});

describe("transcribePodcastEpisode", () => {
  test("stores the transcript and a summary and tags from what is said", async () => {
    const ctx = setup(podcastCard());

    expect(await ctx.run()).toEqual({ transcribed: true });

    const saved = ctx.convex.callsTo(UPDATE_AI).at(-1);
    expect(saved?.args).toMatchObject({
      aiLanguage: "en",
      aiSummary: "An episode about leaves",
      aiTags: ["leaves", "botany"],
      aiTranscript: "Today we talk about leaves.",
    });
    expect(saved?.args.processingStatus).toBeUndefined();
    expect(saved?.guard).toMatchObject({ rev: 1 });
    expect(aiPrompts[0]).toContain("Title: Episode 42: Leaves");
    expect(aiPrompts[0]).toContain("Transcript: Today we talk about leaves.");
    expect(ctx.siteRequests).toEqual([AUDIO]);
    // Whisper read the stored object, which is now gone.
    expect(ctx.fakes.calls[0]?.params).toMatchObject({
      mimeType: "audio/mpeg",
      transcribe: true,
    });
    expect(String(ctx.fakes.calls[0]?.params.sourceKey)).toBe(
      ctx.tracked()[0]?.key
    );
    expectCleanedUp(ctx);
  });

  test.each([
    [
      "too_large",
      () =>
        new Response(new Uint8Array([1]), {
          headers: {
            "content-length": String(2 * 1024 * 1024 * 1024),
            "content-type": "audio/mpeg",
          },
        }),
    ],
    [
      "not_audio",
      () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
    ],
    ["blocked", () => new Response("gone", { status: 404 })],
  ])(
    "a %s episode gets no transcript and leaves nothing stored",
    async (reason, respond) => {
      const ctx = setup(podcastCard(), {
        network: (url) => (url === AUDIO ? respond() : undefined),
      });

      expect(await ctx.run()).toEqual({ reason, transcribed: false });
      expect(ctx.convex.callsTo(UPDATE_AI)).toEqual([]);
      expect(ctx.fakes.calls).toEqual([]);
      expectCleanedUp(ctx);
    }
  );

  test("audio the worker declines gets no transcript and is deleted", async () => {
    const ctx = setup(podcastCard(), {
      processAudio: { fallback: "UNSUPPORTED_TYPE", message: "undecodable" },
    });

    expect(await ctx.run()).toEqual({
      reason: "worker_declined",
      transcribed: false,
    });
    expect(ctx.convex.callsTo(UPDATE_AI)).toEqual([]);
    expectCleanedUp(ctx);
  });

  test.each([
    ["silence", transcribed("   ")],
    [
      "no speech found",
      {
        data: {
          facts: {},
          transcript: { reason: "no_speech", status: "skipped" },
        },
      } as OpAnswer,
    ],
  ])("%s gets no transcript and is deleted", async (_name, answer) => {
    const ctx = setup(podcastCard(), { processAudio: answer });

    expect(await ctx.run()).toEqual({
      reason: "no_speech",
      transcribed: false,
    });
    expect(ctx.convex.callsTo(UPDATE_AI)).toEqual([]);
    expectCleanedUp(ctx);
  });

  test("a summary that fails keeps the transcript and the page's summary", async () => {
    aiFails = true;
    const ctx = setup(
      podcastCard({ aiSummary: "From the page", aiTags: ["page"] })
    );

    expect(await ctx.run()).toEqual({ transcribed: true });
    const saved = ctx.convex.callsTo(UPDATE_AI).at(-1)?.args;
    expect(saved?.aiTranscript).toBe("Today we talk about leaves.");
    expect(saved?.aiSummary).toBeUndefined();
    expect(saved?.aiTags).toBeUndefined();
    // The page's summary keeps its language.
    expect(saved).not.toHaveProperty("aiLanguage");
    expect(ctx.card).toMatchObject({
      aiSummary: "From the page",
      aiTags: ["page"],
      aiTranscript: "Today we talk about leaves.",
    });
    expectCleanedUp(ctx);
  });

  test("audio that can't be deleted stays listed on the card", async () => {
    const ctx = setup(podcastCard());
    ctx.bucket.delete = () => {
      throw new Error("r2 unavailable");
    };

    expect(await ctx.run()).toEqual({ transcribed: true });
    const calls = ctx.tracked();
    expect(calls.map((call) => call.stored)).toEqual([true]);
    expect(ctx.card.workflowArtifactKeys).toEqual([calls[0]?.key]);
  });

  test.each([
    ["on the card", { aiTranscript: "Said before." }],
    ["moved to its text rows", { aiTranscriptCharCount: 12 }],
  ])(
    "a backfill leaves an episode already transcribed alone, transcript %s",
    async (_where, saved) => {
      const ctx = setup(podcastCard(saved));

      expect(
        await transcribePodcastEpisode(
          ctx.job,
          createWorkflowTelemetry(ctx.env),
          {
            keepTranscript: true,
          }
        )
      ).toEqual({ reason: "already_transcribed", transcribed: false });
      expect(ctx.siteRequests).toEqual([]);
      expect(ctx.tracked()).toEqual([]);
    }
  );

  test("a busy renderer throws for the step's retry, after deleting the audio", async () => {
    const ctx = setup(podcastCard(), {
      processAudio: { throws: new Error("files_worker_error:BUSY:503:x") },
    });

    await expect(ctx.run()).rejects.toThrow("BUSY");
    expectCleanedUp(ctx);
  });

  test("past the owner's hourly limit nothing is downloaded", async () => {
    const ctx = setup(podcastCard(), {
      handlers: {
        "workflows/steps/podcast/mutations:takePodcastTranscriptSlot": () =>
          false,
      },
    });

    expect(await ctx.run()).toEqual({
      reason: "rate_limited",
      transcribed: false,
    });
    expect(ctx.siteRequests).toEqual([]);
    expect(ctx.tracked()).toEqual([]);
  });

  test.each([
    [
      "a link that isn't a podcast",
      podcastCard({
        metadata: {
          linkCategory: { category: "music", fetchedAt: 1 },
          linkPreview: { raw: [ogAudio(AUDIO)], status: "success" },
        },
      }),
      {},
      "not_podcast",
    ],
    ["a card in Trash", podcastCard({ isDeleted: true }), {}, "not_podcast"],
    [
      "an owner who turned AI off",
      podcastCard(),
      { "adminAccess:getAiGate": () => "user_disabled" },
      "ai_off",
    ],
  ])("%s asks nothing", async (_name, fields, handlers, reason) => {
    const ctx = setup(fields, { handlers });

    expect(await ctx.run()).toEqual({ reason, transcribed: false });
    expect(ctx.siteRequests).toEqual([]);
    expect(ctx.tracked()).toEqual([]);
  });

  test("a Spotify episode has no public audio", async () => {
    const ctx = setup(
      podcastCard({
        metadata: {
          linkCategory: { category: "podcast", fetchedAt: 1 },
          linkPreview: { status: "success", title: "An episode" },
        },
        url: "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ",
      })
    );

    expect(await ctx.run()).toEqual({
      reason: "no_enclosure",
      transcribed: false,
    });
    expect(ctx.siteRequests).toEqual([]);
    expect(ctx.tracked()).toEqual([]);
  });

  test("an account being deleted fences the episode's key, so no audio is stored", async () => {
    let env: ReturnType<typeof setup>["env"] | undefined;
    const ctx = setup(podcastCard(), {
      handlers: {
        // Account deletion freezes each registered key it finds.
        "storage/ownership:registerObject": async (args) => {
          if (env) {
            await freezeObject(env, String(args.key));
          }
          return true;
        },
      },
    });
    env = ctx.env;

    expect(await ctx.run()).toEqual({ reason: "blocked", transcribed: false });
    expect(ctx.bucket.multipartUploads.size).toBe(0);
    expect(ctx.bucket.multipartCompletions).toEqual([]);
    expect(ctx.fakes.calls).toEqual([]);
    expect(ctx.convex.callsTo(UPDATE_AI)).toEqual([]);
  });

  test("an edit during transcription refuses the write and still deletes the audio", async () => {
    const ctx = setup(podcastCard(), {
      processAudio: () => {
        // The person edits the card while Whisper runs.
        ctx.card.processingRev = 2;
        return transcribed("Today we talk about leaves.");
      },
    });

    await expect(ctx.run()).rejects.toThrow("stale_processing_revision");
    expect(ctx.card.aiTranscript).toBeUndefined();
    expect(ctx.bucket.objects.size).toBe(0);
    // Forgetting the deleted object isn't tied to the run's revision.
    expectCleanedUp(ctx);
    expect(
      ctx.convex.callsTo(TRACK).map((call) => Boolean(call.guard))
    ).toEqual([true, false]);
  });
});
