import type { UploadMultipleFilesResultItem } from "@teak/convex/shared";
import { capBatchForQueue } from "./globalFileDropHelpers";

export interface UploadQueueSnapshot {
  isUploading: boolean;
  queueSize: number;
}

export interface UploadQueueHandlers {
  onFinish: (
    results: UploadMultipleFilesResultItem[],
    skippedCount: number
  ) => void;
  onSkipped: (skippedCount: number) => void;
  onStart: () => void;
  upload: (files: File[]) => Promise<UploadMultipleFilesResultItem[]>;
}

export function createUploadQueue(
  maxFiles: number,
  handlers: () => UploadQueueHandlers
) {
  let pending: File[] = [];
  let uploading = false;
  let skippedCount = 0;
  let snapshot: UploadQueueSnapshot = { isUploading: false, queueSize: 0 };
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = { isUploading: uploading, queueSize: pending.length };
    for (const listener of listeners) {
      listener();
    }
  };

  const uploadPending = async (
    done: UploadMultipleFilesResultItem[]
  ): Promise<UploadMultipleFilesResultItem[]> => {
    if (pending.length === 0) {
      return done;
    }
    const batch = pending;
    const results = await handlers().upload(batch);
    pending = pending.slice(batch.length);
    publish();
    return uploadPending(done.concat(results));
  };

  const drain = async () => {
    uploading = true;
    publish();
    handlers().onStart();
    try {
      const results = await uploadPending([]);
      if (results.length > 0) {
        handlers().onFinish(results, skippedCount);
      }
    } finally {
      skippedCount = 0;
      uploading = false;
      publish();
    }
  };

  return {
    enqueue(files: File[]): Promise<void> | undefined {
      if (files.length === 0) {
        return;
      }
      const { accepted, rejectedCount } = capBatchForQueue(
        files,
        pending.length,
        maxFiles
      );
      skippedCount += rejectedCount;
      if (accepted.length === 0) {
        if (!uploading) {
          handlers().onSkipped(skippedCount);
          skippedCount = 0;
        }
        return;
      }
      pending = pending.concat(accepted);
      publish();
      return uploading ? undefined : drain();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
