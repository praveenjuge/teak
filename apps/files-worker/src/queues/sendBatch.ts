/**
 * Queues take at most 100 messages and 256 KB per `sendBatch`. These split
 * a send into batches inside both limits, with room to spare.
 */
const MAX_MESSAGES_PER_SEND = 100;
const MAX_BYTES_PER_SEND = 200 * 1024;

export const planSendBatches = (bodies: readonly unknown[]): number[][] => {
  const batches: number[][] = [];
  let current: number[] = [];
  let bytes = 0;
  bodies.forEach((body, index) => {
    const size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (
      current.length > 0 &&
      (current.length >= MAX_MESSAGES_PER_SEND ||
        bytes + size > MAX_BYTES_PER_SEND)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(index);
    bytes += size;
  });
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
};

export const sendInBatches = async <Body>(
  queue: Queue<Body>,
  bodies: readonly Body[]
): Promise<Map<number, string>> => {
  const failed = new Map<number, string>();
  for (const batch of planSendBatches(bodies)) {
    try {
      await queue.sendBatch(
        batch.map((index) => ({ body: bodies[index] as Body }))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "queue_failed";
      for (const index of batch) {
        failed.set(index, message);
      }
    }
  }
  return failed;
};
