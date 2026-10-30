import { describe, expect, test } from "bun:test";
import { createContainerStreamingFetch } from "../../media/pinnedHop";
import { createContainerNetwork } from "../../test/cardProcessingKit";
import { FakeBucket } from "../../test/testsupport";
import {
  downloadEpisodeToR2,
  EPISODE_DOWNLOAD_TIMEOUT_MS,
  EPISODE_MAX_REDIRECTS,
  episodeContentType,
} from "./podcastAudio";

// Episode audio streamed into a temporary R2 object: the size cap, the
// content type, every redirect hop checked, and no partial object ever.

const KEY = "users/user_1/card_1/podcast-audio/episode";
const EPISODE = "https://audio.example.com/episode.mp3";
const MiB = 1024 * 1024;

const audio = (
  body: BodyInit | null,
  headers: Record<string, string> = { "content-type": "audio/mpeg" },
  status = 200
) => new Response(body, { headers, status });

/** A body streamed in `chunks` pieces of `size` bytes, no Content-Length. */
const streamed = (chunks: number, size: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i++) {
        controller.enqueue(new Uint8Array(size).fill(i % 256));
      }
      controller.close();
    },
  });

const network = (answer: (url: string) => Response | undefined) => {
  const requests: string[] = [];
  return {
    deps: {
      pinnedFetch: (url: string) => {
        requests.push(url);
        return Promise.resolve(
          answer(url) ?? new Response("missing", { status: 404 })
        );
      },
      resolveDns: () => Promise.resolve(["93.184.216.34"]),
    },
    requests,
  };
};

const redirectChain = (hops: number) =>
  network((url) => {
    const hop = Number(new URL(url).searchParams.get("hop") ?? 0);
    if (hop < hops) {
      return new Response(null, {
        headers: { location: `https://tracker.example.com/r?hop=${hop + 1}` },
        status: 302,
      });
    }
    return audio(new Uint8Array([1, 2, 3]));
  });

describe("episodeContentType", () => {
  test.each([
    ["audio/mpeg", "audio/mpeg"],
    ["Audio/MP4; codecs=mp4a", "audio/mp4"],
    ["video/mp4", "video/mp4"],
    ["application/octet-stream", null],
    ["text/html; charset=utf-8", null],
    [null, null],
  ])("%p is %p", (header, expected) => {
    expect(episodeContentType(header)).toBe(expected);
  });
});

describe("downloadEpisodeToR2", () => {
  test("stores the audio whole, with its type and size", async () => {
    const bucket = new FakeBucket();
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const { deps, requests } = network(() =>
      audio(body, { "content-length": "5", "content-type": "audio/mpeg" })
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ bytes: 5, contentType: "audio/mpeg", stored: true });
    expect(requests).toEqual([EPISODE]);
    expect(bucket.storedBytes(KEY)).toEqual(body);
    expect(bucket.objects.get(KEY)?.httpMetadata).toEqual({
      contentType: "audio/mpeg",
    });
  });

  test("a body over 8 MiB uploads in more than one part", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() =>
      audio(streamed(10, MiB), { "content-type": "audio/mpeg" })
    );
    const parts: number[] = [];
    const original = bucket.createMultipartUpload.bind(bucket);
    bucket.createMultipartUpload = (key, options) => {
      const upload = original(key, options);
      const uploadPart = upload.uploadPart;
      upload.uploadPart = (partNumber, value) => {
        parts.push(partNumber);
        return uploadPart(partNumber, value);
      };
      return upload;
    };

    const result = await downloadEpisodeToR2(
      bucket as never,
      KEY,
      EPISODE,
      deps
    );

    expect(result).toEqual({
      bytes: 10 * MiB,
      contentType: "audio/mpeg",
      stored: true,
    });
    expect(parts).toEqual([1, 2]);
    expect(bucket.storedBytes(KEY)?.byteLength).toBe(10 * MiB);
  });

  test("uneven network reads still upload equal parts, as R2 requires", async () => {
    const bucket = new FakeBucket();
    // About 20 MiB in reads of varying size, like a real connection's.
    const sizes = Array.from({ length: 90 }, (_, i) => 100_000 + i * 3001);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const { deps } = network(() =>
      audio(
        new ReadableStream<Uint8Array>({
          start(controller) {
            sizes.forEach((size, i) => {
              controller.enqueue(new Uint8Array(size).fill(i));
            });
            controller.close();
          },
        }),
        { "content-type": "audio/mpeg" }
      )
    );

    const result = await downloadEpisodeToR2(
      bucket as never,
      KEY,
      EPISODE,
      deps
    );

    expect(result).toEqual({
      bytes: total,
      contentType: "audio/mpeg",
      stored: true,
    });
    // Every read's bytes come back whole and in order.
    const expected = new Uint8Array(total);
    let offset = 0;
    sizes.forEach((size, i) => {
      expected.fill(i, offset, offset + size);
      offset += size;
    });
    expect(bucket.storedBytes(KEY)).toEqual(expected);
  });

  test("a declared length over the cap is refused before anything is read", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() =>
      audio(streamed(1, 10), {
        "content-length": String(2 * 1024 * MiB),
        "content-type": "audio/mpeg",
      })
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "too_large", stored: false });
    expect(bucket.multipartUploads.size).toBe(0);
    expect(bucket.objects.size).toBe(0);
  });

  test("a body without a length that runs past the cap is aborted", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() =>
      audio(streamed(6, 1000), { "content-type": "audio/mpeg" })
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps, 5500)
    ).toEqual({ reason: "too_large", stored: false });
    expect(bucket.multipartUploads.size).toBe(0);
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  test("exactly the cap is stored; one byte more is not", async () => {
    const atCap = new FakeBucket();
    const { deps: exact } = network(() =>
      audio(streamed(4, 1000), { "content-type": "audio/mpeg" })
    );
    expect(
      await downloadEpisodeToR2(atCap as never, KEY, EPISODE, exact, 4000)
    ).toMatchObject({ bytes: 4000, stored: true });

    const over = new FakeBucket();
    const { deps: plusOne } = network(() =>
      audio(streamed(4, 1000), { "content-type": "audio/mpeg" })
    );
    expect(
      await downloadEpisodeToR2(over as never, KEY, EPISODE, plusOne, 3999)
    ).toEqual({ reason: "too_large", stored: false });
    expect(over.objects.has(KEY)).toBe(false);
  });

  test("an MP4 episode is accepted", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() =>
      audio(new Uint8Array([1]), { "content-type": "video/mp4" })
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toMatchObject({ contentType: "video/mp4", stored: true });
  });

  test.each([
    ["an HTML page", "text/html; charset=utf-8"],
    ["an unlabeled download", "application/octet-stream"],
  ])("%s is not audio", async (_name, contentType) => {
    const bucket = new FakeBucket();
    const { deps } = network(() =>
      audio("<html>", { "content-type": contentType })
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "not_audio", stored: false });
    expect(bucket.multipartUploads.size).toBe(0);
  });

  test("an empty body is not audio, and leaves no object", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() => audio(new Uint8Array(0)));

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "not_audio", stored: false });
    expect(bucket.multipartUploads.size).toBe(0);
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  test("a missing episode is blocked", async () => {
    const bucket = new FakeBucket();
    const { deps } = network(() => audio("gone", {}, 404));

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "blocked", stored: false });
  });

  test("follows a chain of tracking redirects, within its limit", async () => {
    const bucket = new FakeBucket();
    const { deps, requests } = redirectChain(6);

    expect(
      await downloadEpisodeToR2(
        bucket as never,
        KEY,
        "https://tracker.example.com/r?hop=0",
        deps
      )
    ).toMatchObject({ bytes: 3, stored: true });
    expect(requests).toHaveLength(7);
  });

  test("more redirects than the limit are refused", async () => {
    const bucket = new FakeBucket();
    const { deps, requests } = redirectChain(EPISODE_MAX_REDIRECTS + 1);

    expect(
      await downloadEpisodeToR2(
        bucket as never,
        KEY,
        "https://tracker.example.com/r?hop=0",
        deps
      )
    ).toEqual({ reason: "blocked", stored: false });
    expect(requests).toHaveLength(EPISODE_MAX_REDIRECTS + 1);
    expect(bucket.multipartUploads.size).toBe(0);
  });

  test("a redirect to a private address is refused before it is requested", async () => {
    const bucket = new FakeBucket();
    const { deps, requests } = network((url) =>
      url === EPISODE
        ? Response.redirect("http://10.0.0.1/episode.mp3", 302)
        : audio(new Uint8Array([1]))
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "blocked", stored: false });
    expect(requests).toEqual([EPISODE]);
  });

  test("a host that resolves to a private address is refused", async () => {
    const bucket = new FakeBucket();
    const { deps, requests } = network(() => audio(new Uint8Array([1])));

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, {
        ...deps,
        resolveDns: () => Promise.resolve(["10.0.0.5"]),
      })
    ).toEqual({ reason: "blocked", stored: false });
    expect(requests).toEqual([]);
  });

  test("a redirect to a name that resolves privately is refused before it is requested", async () => {
    const bucket = new FakeBucket();
    const { deps, requests } = network((url) =>
      url === EPISODE
        ? Response.redirect("https://cdn.internal.example/episode.mp3", 302)
        : audio(new Uint8Array([1]))
    );

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, {
        ...deps,
        resolveDns: (hostname) =>
          Promise.resolve(
            hostname === "cdn.internal.example"
              ? ["10.0.0.5"]
              : ["93.184.216.34"]
          ),
      })
    ).toEqual({ reason: "blocked", stored: false });
    expect(requests).toEqual([EPISODE]);
    expect(bucket.objects.size).toBe(0);
  });

  test("a stream that breaks midway aborts the upload", async () => {
    const bucket = new FakeBucket();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        if (sent > 2) {
          controller.error(new Error("connection reset"));
          return;
        }
        controller.enqueue(new Uint8Array(1000));
      },
    });
    const { deps } = network(() => audio(body));

    expect(
      await downloadEpisodeToR2(bucket as never, KEY, EPISODE, deps)
    ).toEqual({ reason: "blocked", stored: false });
    expect(bucket.multipartUploads.size).toBe(0);
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  test("an episode through the link fetcher Container is stored whole", async () => {
    const network = createContainerNetwork((url) =>
      url === EPISODE
        ? audio(streamed(12, MiB), { "content-type": "audio/mpeg" })
        : undefined
    );
    const bucket = new FakeBucket();
    const result = await downloadEpisodeToR2(
      bucket as unknown as R2Bucket,
      KEY,
      EPISODE,
      {
        pinnedFetch: createContainerStreamingFetch(network.env, {
          maxBytes: 100 * MiB,
          timeoutMs: EPISODE_DOWNLOAD_TIMEOUT_MS,
        }),
        resolveDns: () => Promise.resolve(["93.184.216.34"]),
      }
    );
    expect(result).toEqual({
      bytes: 12 * MiB,
      contentType: "audio/mpeg",
      stored: true,
    });
    expect(network.requests).toEqual([
      { addresses: ["93.184.216.34"], url: EPISODE },
    ]);
  });
});
