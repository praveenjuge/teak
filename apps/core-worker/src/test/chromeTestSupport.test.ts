import { describe, expect, test } from "bun:test";
import { readUntil } from "./chromeTestSupport";

const encoder = new TextEncoder();

/** A stream that sends each chunk after its delay, then stays open. */
const quietStream = (chunks: [number, string][]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [delay, text] of chunks) {
        setTimeout(() => controller.enqueue(encoder.encode(text)), delay);
      }
    },
  });

const URL_PATTERN = /ws:\/\/\S+(?=\s)/u;

describe("readUntil", () => {
  test("finds the address split across chunks", async () => {
    const found = await readUntil(
      quietStream([
        [0, "dbus noise\nDevTools listening on ws://127.0.0.1:9/dev"],
        [5, "tools/browser/abc\n"],
      ]),
      URL_PATTERN,
      1000
    );
    expect(found.match).toBe("ws://127.0.0.1:9/devtools/browser/abc");
  });

  test("gives up on time when the stream goes quiet", async () => {
    const started = Date.now();
    const found = await readUntil(
      quietStream([[0, "Failed to connect to the bus\n"]]),
      URL_PATTERN,
      100
    );
    expect(found.match).toBeNull();
    expect(found.output).toContain("Failed to connect to the bus");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("waits past a slow first line for an address that comes in time", async () => {
    const found = await readUntil(
      quietStream([
        [0, "slow start\n"],
        [150, "DevTools listening on ws://127.0.0.1:9/x\n"],
      ]),
      URL_PATTERN,
      1000
    );
    expect(found.match).toBe("ws://127.0.0.1:9/x");
  });

  test("a stream that ends without the address finds nothing", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("crashed\n"));
        controller.close();
      },
    });
    expect(await readUntil(stream, URL_PATTERN, 1000)).toEqual({
      match: null,
      output: "crashed\n",
    });
  });
});
