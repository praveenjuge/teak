import { describe, expect, test } from "bun:test";
import {
  readResponseBlobWithinLimit,
  readResponseTextWithinLimit,
} from "../../shared/boundedResponse";

const streamingResponse = (onCancel: () => void, close = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      cancel: onCancel,
      start(controller) {
        controller.enqueue(new Uint8Array([65, 66, 67]));
        controller.enqueue(new Uint8Array([68, 69, 70]));
        if (close) {
          controller.close();
        }
      },
    }),
    { headers: { "content-type": "text/plain" } }
  );

describe("bounded response consumers", () => {
  test("reads responses that stay within the byte limit", async () => {
    await expect(
      readResponseTextWithinLimit(
        streamingResponse(() => undefined, true),
        6
      )
    ).resolves.toBe("ABCDEF");
  });

  test("cancels text streams before buffering past the limit", async () => {
    let cancelled = false;
    await expect(
      readResponseTextWithinLimit(
        streamingResponse(() => {
          cancelled = true;
        }),
        5
      )
    ).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });

  test("cancels blob streams before buffering past the limit", async () => {
    let cancelled = false;
    await expect(
      readResponseBlobWithinLimit(
        streamingResponse(() => {
          cancelled = true;
        }),
        5
      )
    ).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });

  test("rejects invalid limits", async () => {
    await expect(
      readResponseTextWithinLimit(new Response("text"), Number.NaN)
    ).rejects.toThrow("maxBytes");
  });
});
