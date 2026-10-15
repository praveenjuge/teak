class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(_expectedLength: number) {
    super();
  }
}

const cacheThatNeverHits: Cache = {
  delete: () => Promise.resolve(false),
  match: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
};

const runtime = globalThis as Record<string, unknown>;
runtime.FixedLengthStream ??= FixedLengthStream;
runtime.caches ??= { default: cacheThatNeverHits };
