import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import {
  fixture,
  health,
  RENDERER_TIMEOUT_URL,
  RENDERER_URL,
  readResult,
  render,
  rendererEndpoint,
  renderFixture,
} from "./helpers";

const CAP = 100 * 1024 * 1024;

/** Sends only the request head and returns the raw response text. */
function rawRequest(head: string): Promise<string> {
  const url = new URL(RENDERER_URL);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(head);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("}")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.on("error", reject);
  });
}

describe.skipIf(!RENDERER_URL)("renderer limits and hostile input", () => {
  test("health answers with the protocol", async () => {
    expect(await health()).toEqual({ ok: true, protocol: 1, busy: false });
  });

  test("unknown paths are not found", async () => {
    const result = await renderFixture("/convert", "h264.mp4");
    expect(result.status).toBe(404);
    expect(result.error?.error).toBe("not_found");
  });

  test.each([
    "/video?frameMax=32",
    "/video?frameMax=abc",
    "/video?scrubFrames=21",
    "/video?scrubMax=1000",
    "/audio?peaks=0",
    "/audio?peaks=1,2,3,4,5",
    "/audio?peaks=45,1001",
    "/audio?whisper=sometimes",
    "/pdf/page?max=5000",
    "/pdf/text?maxPages=0",
    "/pdf/text?maxChars=-1",
  ])("%s is a bad request", async (path) => {
    const result = await renderFixture(path, "h264.mp4");
    expect(result.status).toBe(400);
    expect(result.error?.error).toBe("bad_request");
  });

  test.each([
    ["/probe", "truncated.mp4"],
    ["/video", "truncated.mp4"],
    ["/audio", "truncated.mp4"],
    ["/probe", "playlist.m3u8"],
    ["/video", "playlist.m3u8"],
    ["/audio", "playlist.m3u8"],
    ["/probe", "list.ffconcat"],
    ["/video", "list.ffconcat"],
    ["/audio", "list.ffconcat"],
    ["/probe", "sixty-pages.pdf"],
    ["/pdf/page", "garbage.pdf"],
    ["/pdf/text", "garbage.pdf"],
    ["/pdf/page", "h264.mp4"],
    ["/pdf/text", "playlist.m3u8"],
  ])("%s refuses %s as unsupported", async (path, name) => {
    const result = await renderFixture(path, name);
    expect(result.status).toBe(415);
    expect(result.error?.error).toBe("unsupported");
    expect(result.error?.message).not.toContain("/work");
  });

  test("an empty body is unsupported", async () => {
    const result = await render("/probe", new Uint8Array());
    expect(result.status).toBe(415);
  });

  test("a declared length over 100 MiB is refused before reading", async () => {
    const url = new URL(RENDERER_URL);
    const response = await rawRequest(
      `POST /probe HTTP/1.1\r\nHost: ${url.host}\r\nContent-Length: ${CAP + 1}\r\n\r\n`
    );
    expect(response.startsWith("HTTP/1.1 413")).toBe(true);
    expect(response).toContain('"error":"too_large"');
  });

  test("a streamed body over 100 MiB is cut off with 413", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > CAP) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    const response = await fetch(rendererEndpoint("/probe"), {
      method: "POST",
      body,
    });
    const result = await readResult(response);
    expect(result.status).toBe(413);
    expect(result.error?.error).toBe("too_large");
    expect((await health()).busy).toBe(false);
  });

  test("a second job while one runs is turned away as busy", async () => {
    const bytes = await fixture("h264.mp4");
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(bytes.subarray(0, 1024));
        await gate;
        controller.enqueue(bytes.subarray(1024));
        controller.close();
      },
    });
    const first = fetch(rendererEndpoint("/probe"), { method: "POST", body });

    const started = Date.now();
    while (!(await health()).busy) {
      if (Date.now() - started > 5000) {
        throw new Error("The first job never started");
      }
      await Bun.sleep(20);
    }
    const second = await renderFixture("/probe", "h264.mp4");
    expect(second.status).toBe(503);
    expect(second.error?.error).toBe("busy");

    release();
    const result = await readResult(await first);
    expect(result.status).toBe(200);
    expect(result.manifest?.facts?.videoCodec).toBe("h264");
    expect((await health()).busy).toBe(false);
  });
});

describe.skipIf(!RENDERER_TIMEOUT_URL)("renderer wall clock", () => {
  test.each(["/probe", "/video", "/audio", "/pdf/text"])(
    "%s answers 422 when the job runs out of time",
    async (path) => {
      const name = path.startsWith("/pdf") ? "sixty-pages.pdf" : "h264.mp4";
      const result = await renderFixture(path, name, RENDERER_TIMEOUT_URL);
      expect(result.status).toBe(422);
      expect(result.error?.error).toBe("timeout");
      expect((await health(RENDERER_TIMEOUT_URL)).busy).toBe(false);
    }
  );
});
