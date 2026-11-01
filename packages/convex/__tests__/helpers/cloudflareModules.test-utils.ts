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
