export const PROTOCOL = 1;

export interface MediaFacts {
  audioCodec: string | null;
  durationSeconds: number | null;
  format: string;
  hasAudio: boolean;
  hasVideo: boolean;
  height: number | null;
  videoCodec: string | null;
  width: number | null;
}

export interface Part {
  bytes: Uint8Array;
  name: string;
  type: string;
}

export interface JobResult {
  extra: Record<string, unknown>;
  facts: MediaFacts | null;
  parts: Part[];
}

const NON_ASCII = /[^ -~]/g;

/** Compact JSON that is always a valid HTTP header value. */
export function encodeManifest(result: JobResult): string {
  const manifest = {
    protocol: PROTOCOL,
    facts: result.facts,
    parts: result.parts.map((part) => ({
      name: part.name,
      type: part.type,
      length: part.bytes.byteLength,
    })),
    ...result.extra,
  };
  return JSON.stringify(manifest).replace(
    NON_ASCII,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export function jobResponse(result: JobResult): Response {
  const body = Buffer.concat(result.parts.map((part) => part.bytes));
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
      "x-teak-manifest": encodeManifest(result),
    },
  });
}
