import { describe, expect, test } from "bun:test";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { HostBridge, type ToolResult } from "../bridge";

type Listener = (event: { data: unknown; source: unknown }) => void;

const connectToSdkHost = async () => {
  const listeners: Listener[] = [];
  const hostWindow = {
    postMessage: (message: unknown) => {
      queueMicrotask(() => transport.onmessage?.(message as never));
    },
  };
  const transport: {
    close: () => Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: never) => void;
    send: (message: unknown) => Promise<void>;
    start: () => Promise<void>;
  } = {
    close: () => Promise.resolve(),
    send: (message) => {
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ data: message, source: hostWindow });
        }
      });
      return Promise.resolve();
    },
    start: () => Promise.resolve(),
  };

  const host = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {} },
    {
      hostContext: {
        locale: "de-DE",
        theme: "dark",
        toolInfo: {
          tool: {
            inputSchema: { type: "object" },
            name: "teak_v1_search_cards",
          },
        },
      },
    }
  );
  const opened: string[] = [];
  host.onopenlink = ({ url }) => {
    opened.push(url);
    return Promise.resolve({});
  };
  const sizes: unknown[] = [];
  host.onsizechange = (size) => {
    sizes.push(size);
  };
  let initialized = false;
  host.oninitialized = () => {
    initialized = true;
  };
  await host.connect(transport as never);

  const inputs: unknown[] = [];
  const results: ToolResult[] = [];
  const contexts: unknown[] = [];
  const bridge = new HostBridge(
    hostWindow,
    { addEventListener: (_type, listener) => listeners.push(listener) },
    {
      onHostContextChanged: (context) => contexts.push(context),
      onToolInput: (input) => inputs.push(input),
      onToolResult: (result) => results.push(result),
    }
  );
  const context = await bridge.connect({ name: "Teak", version: "1.0.0" });
  return {
    bridge,
    context,
    contexts,
    host,
    initialized: () => initialized,
    inputs,
    opened,
    results,
    sizes,
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("HostBridge against the MCP Apps SDK host", () => {
  test("completes the handshake and receives the host context", async () => {
    const { context, initialized } = await connectToSdkHost();
    await flush();
    expect(context?.locale).toBe("de-DE");
    expect(context?.theme).toBe("dark");
    expect(context?.toolInfo?.tool?.name).toBe("teak_v1_search_cards");
    expect(initialized()).toBe(true);
  });

  test("receives tool input and the tool result", async () => {
    const { host, inputs, results } = await connectToSdkHost();
    await host.sendToolInput({ arguments: { q: "fonts" } });
    await host.sendToolResult({
      content: [{ text: "Fetched 1 cards", type: "text" }],
      structuredContent: { items: [{ id: "c1", type: "link" }] },
    });
    await flush();
    expect(inputs).toEqual([{ q: "fonts" }]);
    expect(results[0]?.structuredContent).toEqual({
      items: [{ id: "c1", type: "link" }],
    });
  });

  test("follows host context changes", async () => {
    const { contexts, host } = await connectToSdkHost();
    await host.sendHostContextChange({ theme: "light" });
    await flush();
    expect(contexts.at(-1)).toMatchObject({ locale: "de-DE", theme: "light" });
  });

  test("asks the host to open a link and reports its size", async () => {
    const { bridge, opened, sizes } = await connectToSdkHost();
    await bridge.openLink("https://app.teakvault.com/?card=c1");
    bridge.sendSizeChanged({ height: 320, width: 600 });
    await flush();
    expect(opened).toEqual(["https://app.teakvault.com/?card=c1"]);
    expect(sizes).toEqual([{ height: 320, width: 600 }]);
  });

  test("answers the host's teardown request", async () => {
    const { host } = await connectToSdkHost();
    await expect(host.teardownResource({})).resolves.toEqual({});
  });
});

describe("HostBridge", () => {
  test("ignores messages from anything but the host window", () => {
    const listeners: Listener[] = [];
    const posted: unknown[] = [];
    const hostWindow = {
      postMessage: (message: unknown) => posted.push(message),
    };
    const results: unknown[] = [];
    const bridge = new HostBridge(
      hostWindow,
      { addEventListener: (_type, listener) => listeners.push(listener) },
      { onToolResult: (result) => results.push(result) }
    );
    bridge.connect({ name: "Teak", version: "1.0.0" }).catch(() => undefined);
    for (const listener of listeners) {
      listener({
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: {} },
        },
        source: {},
      });
    }
    expect(results).toEqual([]);
    expect(posted[0]).toMatchObject({ method: "ui/initialize" });
  });
});
