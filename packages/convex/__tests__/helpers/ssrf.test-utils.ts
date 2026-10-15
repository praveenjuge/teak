import { mock } from "bun:test";

// The outbound URL policy itself is tested in linkMetadata/ssrf.test.ts.
export const mockSafeFetchPassthrough = () =>
  mock.module(
    Bun.fileURLToPath(import.meta.resolve("../../linkMetadata/ssrf")),
    () => ({
      SsrfError: class SsrfError extends Error {
        reason: string;
        constructor(reason: string, message?: string) {
          super(message ?? reason);
          this.name = "SsrfError";
          this.reason = reason;
        }
      },
      isBlockedIp: () => false,
      detectIpVersion: () => 0,
      assertUrlStructureSafe: (url: string) => new URL(url),
      assertUrlIsSafe: async (url: string) => new URL(url),
      readBodyWithLimit: async (
        response: Pick<Response, "text"> &
          Partial<Pick<Response, "arrayBuffer">>,
        maxBytes: number
      ) => {
        const bytes = response.arrayBuffer
          ? new Uint8Array(await response.arrayBuffer())
          : new TextEncoder().encode(await response.text());
        if (bytes.byteLength > maxBytes) {
          throw new Error(`body_too_large: ${bytes.byteLength}`);
        }
        return bytes;
      },
      safeFetch: async (
        url: string,
        _resolveDns: unknown,
        init?: RequestInit
      ) => ({
        finalUrl: url,
        response: await globalThis.fetch(url, init),
      }),
    })
  );
