import { describe, expect, mock, test } from "bun:test";
import type { UploadMultipleFilesResultItem } from "@teak/convex/shared";
import { createUploadQueue, type UploadQueueHandlers } from "../queue";

const file = (name: string) => new File([name], name);
const uploaded = (files: File[]): UploadMultipleFilesResultItem[] =>
  files.map((item) => ({ cardId: item.name, file: item.name, success: true }));

function setup(maxFiles = 5) {
  const batches: Array<{ files: string[]; finish: () => void }> = [];
  const handlers = {
    onFinish: mock<UploadQueueHandlers["onFinish"]>(),
    onSkipped: mock<UploadQueueHandlers["onSkipped"]>(),
    onStart: mock<UploadQueueHandlers["onStart"]>(),
    upload: (files: File[]) =>
      new Promise<UploadMultipleFilesResultItem[]>((resolve) => {
        batches.push({
          files: files.map((item) => item.name),
          finish: () => resolve(uploaded(files)),
        });
      }),
  };
  const queue = createUploadQueue(maxFiles, () => handlers);
  const settle = async (index: number) => {
    batches[index]?.finish();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { batches, handlers, queue, settle };
}

describe("createUploadQueue", () => {
  test("uploads files added mid-upload in the next batch, then reports once", async () => {
    const { batches, handlers, queue, settle } = setup();
    const run = queue.enqueue([file("a"), file("b")]);
    expect(queue.getSnapshot()).toEqual({ isUploading: true, queueSize: 2 });
    expect(handlers.onStart).toHaveBeenCalledTimes(1);

    expect(queue.enqueue([file("c")])).toBeUndefined();
    expect(queue.getSnapshot().queueSize).toBe(3);

    await settle(0);
    expect(batches.map((batch) => batch.files)).toEqual([["a", "b"], ["c"]]);
    expect(queue.getSnapshot().queueSize).toBe(1);
    expect(handlers.onFinish).not.toHaveBeenCalled();

    await settle(1);
    await run;
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onFinish).toHaveBeenCalledTimes(1);
    const [results, skipped] = handlers.onFinish.mock.calls[0] ?? [];
    expect(results?.map((result) => result.file)).toEqual(["a", "b", "c"]);
    expect(skipped).toBe(0);
    expect(queue.getSnapshot()).toEqual({ isUploading: false, queueSize: 0 });
  });

  test("counts files over the cap and reports them with the result", async () => {
    const { handlers, queue, settle } = setup(2);
    const run = queue.enqueue([file("a"), file("b"), file("c")]);
    queue.enqueue([file("d")]);
    expect(handlers.onSkipped).not.toHaveBeenCalled();

    await settle(0);
    await run;
    expect(handlers.onFinish.mock.calls[0]?.[1]).toBe(2);
  });

  test("reports skipped files at once when nothing is uploading", () => {
    const { handlers, queue } = setup(0);
    queue.enqueue([file("a"), file("b")]);
    expect(handlers.onSkipped).toHaveBeenCalledWith(2);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  test("tells subscribers when the queue changes", async () => {
    const { queue, settle } = setup();
    const listener = mock();
    const unsubscribe = queue.subscribe(listener);
    const run = queue.enqueue([file("a")]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await settle(0);
    await run;
    expect(listener).not.toHaveBeenCalled();
  });
});
