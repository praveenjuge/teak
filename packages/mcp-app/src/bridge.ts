/**
 * The view's side of the MCP Apps protocol (SEP-1865,
 * https://github.com/modelcontextprotocol/ext-apps): JSON-RPC over
 * `postMessage` with the host window. It covers only what a read-only view
 * needs — the handshake, tool input and results, host context, opening links
 * and size reports — so the view ships without the SDK's MCP client and
 * schemas. Messages match `App` in `@modelcontextprotocol/ext-apps`.
 */

export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

export interface HostContext {
  displayMode?: string;
  locale?: string;
  styles?: { css?: { fonts?: string }; variables?: Record<string, string> };
  theme?: "dark" | "light";
  toolInfo?: { tool?: { name?: string } };
}

export interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
}

export interface BridgeHandlers {
  onHostContextChanged?: (context: HostContext) => void;
  onToolCancelled?: () => void;
  onToolInput?: (input: Record<string, unknown>) => void;
  onToolResult?: (result: ToolResult) => void;
}

interface Message {
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
}

export interface HostWindow {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

export interface MessageSource {
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown; source: unknown }) => void
  ) => void;
}

const REQUEST_TIMEOUT_MS = 10_000;

export class HostBridge {
  private context: HostContext | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (result: unknown) => void }
  >();

  private readonly handlers: BridgeHandlers;
  private readonly host: HostWindow;
  private readonly source: MessageSource;

  constructor(
    host: HostWindow,
    source: MessageSource,
    handlers: BridgeHandlers
  ) {
    this.handlers = handlers;
    this.host = host;
    this.source = source;
  }

  /** Starts listening, then completes the `ui/initialize` handshake. */
  async connect(appInfo: { name: string; version: string }) {
    this.source.addEventListener("message", (event) => {
      // Only the host that embeds the view speaks for it.
      if (event.source === this.host) {
        this.receive(event.data);
      }
    });
    const result = (await this.request("ui/initialize", {
      appCapabilities: {},
      appInfo,
      protocolVersion: MCP_APPS_PROTOCOL_VERSION,
    })) as { hostContext?: HostContext } | undefined;
    this.context = result?.hostContext;
    this.notify("ui/notifications/initialized", {});
    return this.context;
  }

  get hostContext(): HostContext | undefined {
    return this.context;
  }

  openLink(url: string) {
    return this.request("ui/open-link", { url });
  }

  sendSizeChanged(size: { height: number; width: number }) {
    this.notify("ui/notifications/size-changed", size);
  }

  private post(message: Message) {
    this.host.postMessage({ jsonrpc: "2.0", ...message }, "*");
  }

  private notify(method: string, params: unknown) {
    this.post({ method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      this.post({ id, method, params });
    });
  }

  private receive(data: unknown) {
    const message = data as Message | null;
    if (!(message && message.jsonrpc === "2.0")) {
      return;
    }
    if (message.method === undefined) {
      const waiting =
        typeof message.id === "number" ? this.pending.get(message.id) : null;
      if (waiting) {
        this.pending.delete(message.id as number);
        if (message.error) {
          waiting.reject(new Error(message.error.message));
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.id !== undefined) {
      this.answer(message);
      return;
    }
    this.handle(message.method, message.params);
  }

  /** The host's requests: teardown and ping need only an empty result. */
  private answer(message: Message) {
    if (
      message.method === "ui/resource-teardown" ||
      message.method === "ping"
    ) {
      this.post({ id: message.id, result: {} });
      return;
    }
    this.post({
      error: { code: -32_601, message: "Method not found" },
      id: message.id,
    });
  }

  private handle(method: string, params: unknown) {
    switch (method) {
      case "ui/notifications/tool-input":
        this.handlers.onToolInput?.(
          (params as { arguments?: Record<string, unknown> } | undefined)
            ?.arguments ?? {}
        );
        return;
      case "ui/notifications/tool-result":
        this.handlers.onToolResult?.((params ?? {}) as ToolResult);
        return;
      case "ui/notifications/tool-cancelled":
        this.handlers.onToolCancelled?.();
        return;
      case "ui/notifications/host-context-changed":
        this.context = { ...this.context, ...(params as HostContext) };
        this.handlers.onHostContextChanged?.(this.context);
        return;
      default:
        return;
    }
  }
}
