const UPLOAD_CONCURRENCY = 3;
const UPLOAD_PART_TIMEOUT_MS = 30_000;
const UPLOAD_RETRY_DELAYS_MS = [300, 900] as const;

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
  const totalBytes = Math.max(file.size, 1);
  const completeBytes = plan.uploadedParts.reduce((total, partNumber) => {
    const start = (partNumber - 1) * plan.partSize;
    return total + Math.min(plan.partSize, file.size - start);
  }, 0);
  let uploadedBytes = completeBytes;
  onProgress(Math.round((uploadedBytes / totalBytes) * 100));
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
      try {
        // Each worker uploads its assigned parts sequentially; cross-part
        // concurrency comes from running UPLOAD_CONCURRENCY workers in parallel.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await putPartWithRetry(part, chunk, controllers);
        uploadedBytes += chunk.size;
        onProgress(
          Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
        );
      } catch (error) {
        stopWorkers(error);
        return;
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

async function putPartWithRetry(
  part: UploadPlan["parts"][number],
  chunk: Blob,
  controllers: Set<AbortController>
) {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= UPLOAD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      const response = await putPart(part, chunk, controllers);
      if (
        response.ok ||
        !isRetriableUploadStatus(response.status) ||
        attempt === UPLOAD_RETRY_DELAYS_MS.length
      ) {
        if (!response.ok) {
          throw uploadPartError(part.partNumber, response.status);
        }
        return;
      }
      lastError = uploadPartError(part.partNumber, response.status);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt === UPLOAD_RETRY_DELAYS_MS.length) {
        throw error;
      }
    }

    // Retry sleeps must also be abortable by the Cancel import button.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await sleep(UPLOAD_RETRY_DELAYS_MS[attempt], controllers);
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

async function putPart(
  part: UploadPlan["parts"][number],
  chunk: Blob,
  controllers: Set<AbortController>
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPLOAD_PART_TIMEOUT_MS);
  controllers.add(controller);
  try {
    return await fetch(part.url, {
      body: chunk,
      method: "PUT",
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new Error(`Upload part ${part.partNumber} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
  }
}

function sleep(delayMs: number, controllers: Set<AbortController>) {
  const controller = new AbortController();
  controllers.add(controller);
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  }).finally(() => {
    controllers.delete(controller);
  });
}

function isRetriableUploadStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function uploadPartError(partNumber: number, status: number) {
  return new Error(`Upload part ${partNumber} failed (${status})`);
}
