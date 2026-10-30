import { mock } from "bun:test";

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

// The Workers runtime modules Bun cannot resolve. Workflow code only needs
// NonRetryableError's name and the WorkflowEntrypoint base class.

class NonRetryableError extends Error {
  constructor(message: string, name = "NonRetryableError") {
    super(message);
    this.name = name;
  }
}

class WorkflowEntrypoint<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

mock.module("cloudflare:workflows", () => ({ NonRetryableError }));
mock.module("cloudflare:workers", () => ({ WorkflowEntrypoint }));
