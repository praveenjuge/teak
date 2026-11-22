import { describe, expect, test } from "bun:test";
import { installFilesPlugin } from "../../scripts/installFilesPlugin";
import { webManifest } from "../lib/webManifest";

type Middleware = (
  request: { url?: string },
  response: {
    end: (body: string) => void;
    setHeader: (name: string, value: string) => void;
  },
  next: () => void
) => void;

// The dev server's answer for one path, through the plugin's middleware.
function devRequest(url: string) {
  let middleware: Middleware | undefined;
  const plugin = installFilesPlugin() as unknown as {
    configureServer: (server: unknown) => void;
  };
  plugin.configureServer({
    middlewares: {
      use: (fn: Middleware) => {
        middleware = fn;
      },
    },
  });
  const headers = new Map<string, string>();
  let body: string | undefined;
  let passed = false;
  middleware?.(
    { url },
    {
      end: (text) => {
        body = text;
      },
      setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    },
    () => {
      passed = true;
    }
  );
  return { body, headers, passed };
}

// The files the plugin adds to an environment's build output.
function built(environment: string) {
  const emitted: { fileName: string; source: string }[] = [];
  const plugin = installFilesPlugin() as unknown as {
    generateBundle: (this: unknown) => void;
  };
  plugin.generateBundle.call({
    emitFile: (file: { fileName: string; source: string }) =>
      emitted.push(file),
    environment: { name: environment },
  });
  return emitted;
}

describe("the install files plugin", () => {
  test("writes the manifest and the service worker into the client build only", () => {
    const client = built("client");
    expect(client.map(({ fileName }) => fileName).sort()).toEqual([
      "manifest.webmanifest",
      "sw.js",
    ]);
    const manifest = client.find(
      (file) => file.fileName === "manifest.webmanifest"
    );
    expect(JSON.parse(manifest?.source ?? "{}")).toEqual(webManifest());
    expect(built("ssr")).toEqual([]);
  });

  test("serves both in development with their headers, query string or not", () => {
    const worker = devRequest("/sw.js?v=2");
    expect(worker.passed).toBe(false);
    expect(worker.headers.get("content-type")).toContain("text/javascript");
    expect(worker.headers.get("service-worker-allowed")).toBe("/");
    expect(worker.body).toContain('addEventListener("fetch"');
    const manifest = devRequest("/manifest.webmanifest");
    expect(manifest.headers.get("content-type")).toBe(
      "application/manifest+json"
    );
  });

  test("leaves every other request to Vite and the Worker", () => {
    expect(devRequest("/").passed).toBe(true);
    expect(devRequest("/sw.json").passed).toBe(true);
  });
});
