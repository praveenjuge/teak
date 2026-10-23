import { describe, expect, mock, test } from "bun:test";
import {
  UPLOAD_TIMED_OUT_MESSAGE,
  type UploadResponse,
  uploadAttemptTimeoutMs,
  uploadWithTransientRetry,
} from "../transport";

const stall = (signal: AbortSignal) =>
  new Promise<UploadResponse>((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    });
  });

describe("uploadWithTransientRetry", () => {
  test("retries an attempt that stops responding", async () => {
    const upload = mock((signal: AbortSignal) =>
      upload.mock.calls.length === 1
        ? stall(signal)
        : Promise.resolve({ ok: true, status: 200 })
    );

    const response = await uploadWithTransientRetry(
      upload,
      new AbortController().signal,
      { timeoutMs: 20 }
    );

    expect(response.ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  test("gives up with a readable error when every attempt stalls", async () => {
    const upload = mock(stall);

    await expect(
      uploadWithTransientRetry(upload, new AbortController().signal, {
        timeoutMs: 20,
      })
    ).rejects.toThrow(UPLOAD_TIMED_OUT_MESSAGE);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  test("cancelling the upload aborts the attempt in flight", async () => {
    const controller = new AbortController();
    const upload = mock(stall);

    const result = uploadWithTransientRetry(upload, controller.signal, {
      timeoutMs: 60_000,
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("gives bigger bodies longer to send", () => {
    expect(uploadAttemptTimeoutMs(0)).toBe(60_000);
    expect(uploadAttemptTimeoutMs(8 * 1024 * 1024)).toBeGreaterThan(
      uploadAttemptTimeoutMs(1024 * 1024)
    );
  });
});
