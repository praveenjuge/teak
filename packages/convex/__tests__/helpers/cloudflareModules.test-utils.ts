// Stand-ins for the Workers runtime modules (`cloudflare:workers`,
// `cloudflare:workflows`) the Core Worker imports, so convex-test suites can
// run its code in-process. vitest.config.ts aliases both to this file.

export class NonRetryableError extends Error {
  constructor(message: string, name = "NonRetryableError") {
    super(message);
    this.name = name;
  }
}

export class WorkflowEntrypoint<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
