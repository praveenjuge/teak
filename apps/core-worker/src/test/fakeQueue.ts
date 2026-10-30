export interface SettledMessage {
  body: unknown;
  outcome: "ack" | "pending" | "retry";
  retryDelaySeconds?: number;
}

export const createFakeBatch = (
  queue: string,
  bodies: unknown[],
  attempts = 1
) => {
  const settled: SettledMessage[] = bodies.map((body) => ({
    body,
    outcome: "pending",
  }));
  const messages = bodies.map((body, index) => {
    const record = settled[index] as SettledMessage;
    return {
      ack: () => {
        record.outcome = "ack";
      },
      attempts,
      body,
      id: `message-${String(index)}`,
      retry: (options?: { delaySeconds?: number }) => {
        record.outcome = "retry";
        record.retryDelaySeconds = options?.delaySeconds;
      },
      timestamp: new Date(0),
    };
  });
  const batch = {
    ackAll: () => {
      for (const message of messages) {
        message.ack();
      }
    },
    messages,
    queue,
    retryAll: () => {
      for (const message of messages) {
        message.retry();
      }
    },
  } as unknown as MessageBatch<unknown>;
  return {
    batch,
    outcomes: () => settled.map((message) => message.outcome),
    settled,
  };
};

export const createFakeQueue = (options: { failSend?: boolean } = {}) => {
  const sent: Array<{ body: unknown; delaySeconds?: number }> = [];
  const queue = {
    send: (body: unknown, sendOptions?: { delaySeconds?: number }) => {
      if (options.failSend) {
        return Promise.reject(new Error("queue unavailable"));
      }
      sent.push({ body, delaySeconds: sendOptions?.delaySeconds });
      return Promise.resolve();
    },
    sendBatch: (
      messages: Iterable<{ body: unknown; delaySeconds?: number }>
    ) => {
      if (options.failSend) {
        return Promise.reject(new Error("queue unavailable"));
      }
      for (const message of messages) {
        sent.push({ body: message.body, delaySeconds: message.delaySeconds });
      }
      return Promise.resolve();
    },
  } as unknown as Queue<unknown>;
  return { queue, sent };
};
