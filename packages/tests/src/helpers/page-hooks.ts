import type { JsonValue } from "e2e";
import { env } from "./env";
import type { Browser } from "./test";

/**
 * Stand-ins for the Playwright page events and WebSocket routing that e2e
 * doesn't offer: init scripts in the page, reporting back through routes the
 * test process answers. Each takes effect from the next navigation on.
 */

const HOOK_PATH = "/__teak-e2e-hook/";

export const capturePageErrors = async (browser: Browser) => {
  const errors: string[] = [];
  await browser.route(new RegExp(`${HOOK_PATH}page-error$`), async (route) => {
    errors.push(route.request.postData ?? "");
    await route.fulfill({ status: 204, body: "" });
  });
  await browser.addInitScript((hookPath: string) => {
    const report = (message: string) => {
      fetch(`${location.origin}${hookPath}page-error`, {
        body: message,
        keepalive: true,
        method: "POST",
      }).catch(() => undefined);
    };
    addEventListener("error", (event: ErrorEvent) => {
      report(event.error?.message ?? event.message);
    });
    addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      report(
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason)
      );
    });
  }, HOOK_PATH);
  return {
    /** The messages so far; reports from a page still unloading may follow. */
    get errors(): readonly string[] {
      return errors;
    },
  };
};

export const recordToasts = async (browser: Browser) => {
  const toasts: string[] = [];
  await browser.route(new RegExp(`${HOOK_PATH}toast$`), async (route) => {
    toasts.push(route.request.postData ?? "");
    await route.fulfill({ status: 204, body: "" });
  });
  await browser.evaluate((hookPath: string) => {
    new MutationObserver((mutations) => {
      for (const node of mutations.flatMap((m) => [...m.addedNodes])) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        const added = node.matches("[data-sonner-toast]")
          ? [node]
          : node.querySelectorAll("[data-sonner-toast]");
        for (const toast of added) {
          fetch(`${location.origin}${hookPath}toast`, {
            body: toast.textContent ?? "",
            keepalive: true,
            method: "POST",
          }).catch(() => undefined);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    return null;
  }, HOOK_PATH);
  return {
    get toasts(): readonly string[] {
      return toasts;
    },
  };
};

export const blockAndRecordRequests = async (
  browser: Browser,
  pattern: RegExp
) => {
  const urls: string[] = [];
  await browser.route(pattern, async (route) => {
    urls.push(route.request.url);
    await route.abort();
  });
  return urls;
};

export type SocketMessage = Record<string, any>;

/**
 * What an interceptor can do from inside the page. `state` is a plain object
 * on `window.__teakSocket.state` that the test reads with `readSocketState`.
 */
export interface SocketContext {
  state: Record<string, any>;
  toClient: (message: SocketMessage) => void;
}

/**
 * An interceptor runs in the page, so it must be self-contained: no imports
 * and no variables from the test. Return the message to pass it on (changed
 * or not), or `null` to drop it.
 */
export type SocketInterceptor = (
  message: SocketMessage,
  context: SocketContext
) => SocketMessage | null;

export interface SocketRouting {
  fromClient?: SocketInterceptor;
  fromServer?: SocketInterceptor;
  unreachable?: boolean;
}

function installSocketRouting(
  config: { prefix: string; unreachable: boolean },
  fromClient: SocketInterceptor | null,
  fromServer: SocketInterceptor | null
) {
  const Native = window.WebSocket;
  const shared: { sockets: WebSocket[]; state: Record<string, any> } = {
    sockets: [],
    state: {},
  };
  (window as any).__teakSocket = shared;
  const forwarded = new WeakSet<Event>();
  class RoutedWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = String(url);
      const routed = target.startsWith(config.prefix);
      // Port 9 (discard) refuses the connection: the backend looks down.
      super(
        routed && config.unreachable ? "ws://127.0.0.1:9/" : url,
        protocols
      );
      if (!routed || config.unreachable) {
        return;
      }
      shared.sockets.push(this);
      const context = {
        state: shared.state,
        toClient: (message: SocketMessage) => {
          setTimeout(() => {
            const event = new MessageEvent("message", {
              data: JSON.stringify(message),
            });
            forwarded.add(event);
            this.dispatchEvent(event);
          }, 0);
        },
      };
      (this as any).__teakContext = context;
      // Registered before the app's own listeners, so it sees each message
      // first and can hold it back from them.
      this.addEventListener("message", (event) => {
        if (forwarded.has(event) || !fromServer) {
          return;
        }
        event.stopImmediatePropagation();
        const next = fromServer(JSON.parse(String(event.data)), context);
        if (next !== null) {
          context.toClient(next);
        }
      });
    }

    send(data: Parameters<WebSocket["send"]>[0]) {
      const context = (this as any).__teakContext as SocketContext | undefined;
      if (!(context && fromClient) || typeof data !== "string") {
        super.send(data);
        return;
      }
      const next = fromClient(JSON.parse(data), context);
      if (next !== null) {
        super.send(JSON.stringify(next));
      }
    }
  }
  window.WebSocket = RoutedWebSocket as typeof WebSocket;
}

/**
 * Routes the browser's Convex sync socket through page-side interceptors,
 * the stand-in for Playwright's `routeWebSocket`. Install it before the page
 * that opens the socket loads.
 */
export const routeConvexSocket = async (
  browser: Browser,
  routing: SocketRouting
) => {
  const config = {
    prefix: env.convexUrl.replace(/^http/, "ws"),
    unreachable: routing.unreachable ?? false,
  };
  const source = (fn?: SocketInterceptor) => (fn ? fn.toString() : "null");
  await browser.addInitScript(
    `(${installSocketRouting.toString()})(${JSON.stringify(config)}, ${source(routing.fromClient)}, ${source(routing.fromServer)});`
  );
};

export const readSocketState = <T = Record<string, unknown>>(
  browser: Browser
): Promise<T> =>
  browser.evaluate(() =>
    JSON.parse(JSON.stringify((window as any).__teakSocket?.state ?? {}))
  ) as Promise<T>;

/**
 * Delivers `message` to the app on the newest routed Convex socket, as if
 * the server had sent it. A test uses it to release, at a moment it chooses,
 * a response an interceptor held back (an interceptor returns `null` and
 * records what it saw in `state`).
 */
export const deliverToClient = async (
  browser: Browser,
  message: SocketMessage
) => {
  const delivered = await browser.evaluate((payload) => {
    const sockets: Array<{ __teakContext?: SocketContext }> =
      (window as any).__teakSocket?.sockets ?? [];
    const context = sockets.at(-1)?.__teakContext;
    if (!context) {
      return false;
    }
    context.toClient(payload as SocketMessage);
    return true;
  }, message as JsonValue);
  if (!delivered) {
    throw new Error("No routed Convex socket to deliver the message to");
  }
};
