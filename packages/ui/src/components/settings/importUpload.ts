const UPLOAD_CONCURRENCY = 3;

export interface UploadPlan {
  jobId: string;
  partSize: number;
  parts: Array<{ partNumber: number; url: string }>;
  uploadedParts: number[];
}

export async function putParts(
  file: File,
  plan: UploadPlan,
  onProgress: (percent: number) => void,
  controllers: Set<AbortController>
) {
  const completeBytes = plan.uploadedParts.reduce((total, partNumber) => {
    const start = (partNumber - 1) * plan.partSize;
    return total + Math.min(plan.partSize, file.size - start);
  }, 0);
  let uploadedBytes = completeBytes;
  onProgress(Math.round((uploadedBytes / file.size) * 100));
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const stopWorkers = (error: unknown) => {
    if (failed) {
      return;
    }
    failed = true;
    failure = error;
    for (const controller of controllers) {
      controller.abort();
    }
  };
  const worker = async () => {
    for (;;) {
      if (failed) {
        return;
      }
      const part = plan.parts[nextIndex];
      nextIndex += 1;
      if (!part) {
        return;
      }
      const start = (part.partNumber - 1) * plan.partSize;
      const chunk = file.slice(
        start,
        Math.min(start + plan.partSize, file.size)
      );
      const controller = new AbortController();
      controllers.add(controller);
      try {
        // Each worker uploads its assigned parts sequentially; cross-part
        // concurrency comes from running UPLOAD_CONCURRENCY workers in parallel.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const response = await fetch(part.url, {
          method: "PUT",
          body: chunk,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Upload part ${part.partNumber} failed (${response.status})`
          );
        }
        uploadedBytes += chunk.size;
        onProgress(
          Math.min(100, Math.round((uploadedBytes / file.size) * 100))
        );
      } catch (error) {
        stopWorkers(error);
        return;
      } finally {
        controllers.delete(controller);
      }
    }
  };
  // The guard below reads `failed`, which the awaited workers set on failure,
  // so this await cannot be deferred past it.
  // react-doctor-disable-next-line react-doctor/async-defer-await
  await Promise.all(
    Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, plan.parts.length) },
      worker
    )
  );
  if (failed) {
    throw failure;
  }
}
