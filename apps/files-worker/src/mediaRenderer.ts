import { RENDERER_PORT, RENDERER_PROTOCOL } from "../container/src/protocol";

const READY_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 250;
const HEALTH_REQUEST_TIMEOUT_MS = 1000;
export const RENDERER_INACTIVITY_TIMEOUT_MS = 90_000;

export interface RendererContainer {
  getTcpPort: (port: number) => {
    fetch: (request: Request) => Promise<Response>;
  };
  monitor: () => Promise<void>;
  readonly running: boolean;
  setInactivityTimeout: (durationMs: number) => Promise<void>;
  start: (options: { enableInternet: boolean }) => void;
}

export interface RendererState {
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
  readonly container?: RendererContainer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const rendererUnavailable = (message: string): Response =>
  Response.json({ error: "unavailable", message }, { status: 503 });

export class MediaRenderer {
  protected readonly enableInternet: boolean = false;
  protected readonly port: number = RENDERER_PORT;
  protected readonly protocol: number = RENDERER_PROTOCOL;
  private readonly state: RendererState;
  private ready: Promise<void> | null = null;

  constructor(state: DurableObjectState | RendererState, _env?: unknown) {
    this.state = state as RendererState;
    const container = this.state.container;
    // The inactivity timeout does not survive a Durable Object restart.
    if (container?.running) {
      this.state
        .blockConcurrencyWhile(() =>
          container.setInactivityTimeout(RENDERER_INACTIVITY_TIMEOUT_MS)
        )
        .catch(() => undefined);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const container = this.state.container;
    if (!container) {
      return rendererUnavailable("container_missing");
    }
    try {
      await this.ensureReady(container);
    } catch (error) {
      return rendererUnavailable(
        error instanceof Error ? error.message : "container_start_failed"
      );
    }
    const url = new URL(request.url);
    const forwarded = new Request(
      `http://container${url.pathname}${url.search}`,
      request
    );
    try {
      return await container.getTcpPort(this.port).fetch(forwarded);
    } catch (error) {
      this.ready = null;
      return rendererUnavailable(
        error instanceof Error ? error.message : "container_request_failed"
      );
    }
  }

  private ensureReady(container: RendererContainer): Promise<void> {
    if (!container.running) {
      this.ready = null;
    }
    this.ready ??= this.start(container).catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async start(container: RendererContainer): Promise<void> {
    if (!container.running) {
      container.start({ enableInternet: this.enableInternet });
      container
        .monitor()
        .catch(() => undefined)
        .finally(() => {
          this.ready = null;
        });
    }
    await container.setInactivityTimeout(RENDERER_INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(this.port);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.reportsProtocol(port)) {
        return;
      }
      await sleep(HEALTH_POLL_MS);
    }
    throw new Error("container_not_ready");
  }

  private async reportsProtocol(
    port: ReturnType<RendererContainer["getTcpPort"]>
  ): Promise<boolean> {
    try {
      const response = await port.fetch(
        new Request("http://container/health", {
          signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
        })
      );
      const health = (await response.json().catch(() => null)) as {
        protocol?: unknown;
      } | null;
      return response.ok && health?.protocol === this.protocol;
    } catch {
      return false;
    }
  }
}
