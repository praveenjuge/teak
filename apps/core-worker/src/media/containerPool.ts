import { OpFailure } from "../opFailure";
import { CONTAINER_READY_TIMEOUT_MS } from "./mediaRenderer";

/**
 * The renderer, link fetcher or browser didn't answer: the op answers
 * RENDERER_UNAVAILABLE, as `browser_unavailable` does.
 */
export class RendererUnavailable extends OpFailure {
  readonly reason: string;
  constructor(reason: string) {
    super("browser_unavailable", {
      message: `renderer_unavailable:${reason}`,
    });
    this.reason = reason;
  }
}

const DEFAULT_POOL_SIZE = 2;
const MAX_POOL_SIZE = 16;

/**
 * Added to a request's own timeout: a cold Container first starts and
 * reports its protocol, which `MediaRenderer` waits for.
 */
export const CONTAINER_START_ALLOWANCE_MS = CONTAINER_READY_TIMEOUT_MS + 10_000;

/** `*_INSTANCES` must match the Container's `max_instances` in Wrangler. */
export const containerPoolSize = (instances: string | undefined): number => {
  const parsed = Number(instances);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_POOL_SIZE)
    : DEFAULT_POOL_SIZE;
};

/**
 * Every instance once, starting at a random one. The names are Durable
 * Object ids, so they never change.
 */
export const containerInstanceOrder = (
  size: number,
  random: () => number,
  prefix: ContainerPool["host"]
): string[] => {
  const start = Math.floor(random() * size) % size;
  return Array.from(
    { length: size },
    (_, index) => `${prefix}-${(start + index) % size}`
  );
};

/**
 * Workers send a stream of unknown length as chunked. This gives it a
 * Content-Length (R2 and the Containers need one up front), and the stream
 * errors if the source sends more or fewer bytes than it declared.
 */
export const withFixedLength = (
  body: ReadableStream,
  length: number
): ReadableStream => {
  const { FixedLengthStream: FixedLength } = globalThis as unknown as {
    FixedLengthStream: typeof FixedLengthStream;
  };
  const { readable, writable } = new FixedLength(length);
  body.pipeTo(writable).catch(() => undefined);
  return readable;
};

export interface ContainerPool {
  host: "fetcher" | "renderer";
  namespace: DurableObjectNamespace | undefined;
  /** Prefixes each unavailable reason. */
  reasonPrefix: "" | "fetcher_";
  size: number;
}

export interface PoolRequest {
  /** Read once per instance tried, so a stream is opened fresh each time. */
  body: () => Promise<{ body: BodyInit; contentType: string }>;
  /** Why an instance answered 503; the next instance is tried. */
  busyReason?: (response: Response) => Promise<string>;
  path: string;
  /** Covers starting the Container and reading the response. */
  timeoutMs: number;
}

/**
 * Posts to the pool's instances in turn until one isn't busy (503) and
 * returns its response. Throws `RendererUnavailable` when the binding is
 * missing, a request fails or times out, or every instance is busy.
 */
export const postToPool = async (
  pool: ContainerPool,
  request: PoolRequest,
  random: () => number = Math.random
): Promise<Response> => {
  const { namespace, reasonPrefix } = pool;
  if (!namespace) {
    throw new RendererUnavailable(`${reasonPrefix}binding_missing`);
  }
  let lastReason = "busy";
  for (const name of containerInstanceOrder(pool.size, random, pool.host)) {
    const { body, contentType } = await request.body();
    let response: Response;
    try {
      response = await namespace.get(namespace.idFromName(name)).fetch(
        new Request(`http://${pool.host}${request.path}`, {
          body,
          headers: { "content-type": contentType },
          method: "POST",
          signal: AbortSignal.timeout(request.timeoutMs),
        })
      );
    } catch (error) {
      if (body instanceof ReadableStream) {
        await body.cancel().catch(() => undefined);
      }
      throw new RendererUnavailable(
        error instanceof Error && error.name === "TimeoutError"
          ? `${reasonPrefix}timeout`
          : `${reasonPrefix}request_failed`
      );
    }
    if (response.status !== 503) {
      return response;
    }
    if (request.busyReason) {
      lastReason = await request.busyReason(response);
    } else {
      lastReason = `${reasonPrefix}busy`;
      await response.body?.cancel().catch(() => undefined);
    }
  }
  throw new RendererUnavailable(lastReason);
};
