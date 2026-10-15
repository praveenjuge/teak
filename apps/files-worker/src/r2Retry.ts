// R2 occasionally fails a read with an error Cloudflare documents as safe to
// retry: 10001 (internal error), 10043 (service unavailable) and 10058 (too
// many requests). The binding surfaces them as `<method>: <message> (<code>)`.
// Reads are idempotent, so they are retried briefly here instead of failing
// the request; writes go through the deletion gate and are never retried.

const TRANSIENT_R2_ERROR = /\((?:10001|10043|10058)\)$/u;
const RETRIED_METHODS = new Set<PropertyKey>(["get", "head"]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

export const isTransientR2Error = (error: unknown): boolean =>
  error instanceof Error && TRANSIENT_R2_ERROR.test(error.message);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function retryingReads(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if (!RETRIED_METHODS.has(property)) {
        return value.bind(target);
      }
      return async (...args: unknown[]) => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            return await value.apply(target, args);
          } catch (error) {
            if (attempt >= MAX_ATTEMPTS || !isTransientR2Error(error)) {
              throw error;
            }
            await wait(BASE_DELAY_MS * attempt);
          }
        }
      };
    },
  });
}
