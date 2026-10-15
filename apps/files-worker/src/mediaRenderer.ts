/**
 * Durable Object that owns one media renderer Container (ffmpeg and poppler;
 * see container/). It starts the Container without internet access, waits for
 * its health check, and forwards requests to port 8080. The Container runs one
 * job at a time and answers 503 `busy` to a second one; rendererClient picks
 * another instance from the pool.
 */

export const RENDERER_PORT = 8080;
export const RENDERER_PROTOCOL = 1;
const READY_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 250;
const HEALTH_REQUEST_TIMEOUT_MS = 1000;
// Long enough to reuse a warm instance across a card's video or audio steps.
export const RENDERER_INACTIVITY_TIMEOUT_MS = 90_000;

/** The slice of the Durable Object Container API this class uses. */
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
  /** The renderer works only on bytes the Worker sends it. */
  protected readonly enableInternet: boolean = false;
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
      return await container.getTcpPort(RENDERER_PORT).fetch(forwarded);
    } catch (error) {
      // The Container stopped or crashed mid-request; the next call restarts it.
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
      // Forget readiness once the Container exits, whatever the reason.
      container
        .monitor()
        .catch(() => undefined)
        .finally(() => {
          this.ready = null;
        });
    }
    await container.setInactivityTimeout(RENDERER_INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(RENDERER_PORT);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch(
          new Request("http://container/health", {
            signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
          })
        );
        const health = (await response.json().catch(() => null)) as {
          protocol?: unknown;
        } | null;
        if (response.ok && health?.protocol === RENDERER_PROTOCOL) {
          return;
        }
      } catch {
        // Not listening yet.
      }
      await sleep(HEALTH_POLL_MS);
    }
    throw new Error("container_not_ready");
  }
}
