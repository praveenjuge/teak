import {
  type DnsResolver,
  type PinnedFetch,
  safeFetch,
} from "@teak/convex/linkMetadata/ssrf";
import { FILES_UPLOAD_MAX_BYTES } from "@teak/files-protocol";
import { ObjectWriteBlockedError } from "../../deletionGate";

// A podcast episode's audio, streamed from its host into a temporary R2
// object for transcription. Every hop goes through `safeFetch` (each one
// checked, connections pinned). Only audio, or an MP4 episode, up to the
// 100 MB upload cap; nothing longer is read past the cap.

/** Tracking redirects stack up in front of episodes; each hop is checked. */
export const EPISODE_MAX_REDIRECTS = 8;
const PART_BYTES = 8 * 1024 * 1024;
/** The whole download, body included. */
export const EPISODE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

export type EpisodeDownload =
  | { bytes: number; contentType: string; stored: true }
  | { reason: "blocked" | "not_audio" | "too_large"; stored: false };

export interface EpisodeDownloadDeps {
  pinnedFetch: PinnedFetch;
  resolveDns: DnsResolver;
  /** Tests shorten the whole download's time limit. */
  timeoutMs?: number;
}

/** `audio/*` or `video/mp4`, without parameters; anything else is refused. */
export const episodeContentType = (header: string | null): string | null => {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  if (!type) {
    return null;
  }
  return type.startsWith("audio/") || type === "video/mp4" ? type : null;
};

const cancel = (response: Response) =>
  response.body?.cancel().catch(() => undefined);

/**
 * Downloads `url` into `key`. Never leaves a partial object: a body over the
 * cap or a broken stream aborts the upload.
 */
export const downloadEpisodeToR2 = async (
  bucket: R2Bucket,
  key: string,
  url: string,
  deps: EpisodeDownloadDeps,
  maxBytes = FILES_UPLOAD_MAX_BYTES
): Promise<EpisodeDownload> => {
  const timeoutMs = deps.timeoutMs ?? EPISODE_DOWNLOAD_TIMEOUT_MS;
  let response: Response;
  try {
    // The hop limit runs while the body streams, so it is the whole
    // download's limit rather than safeFetch's 30 seconds.
    ({ response } = await safeFetch(
      url,
      deps.resolveDns,
      {
        headers: { accept: "audio/*, video/mp4", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      },
      deps.pinnedFetch,
      EPISODE_MAX_REDIRECTS,
      timeoutMs
    ));
  } catch {
    return { reason: "blocked", stored: false };
  }
  if (!(response.ok && response.body)) {
    await cancel(response);
    return { reason: "blocked", stored: false };
  }
  const contentType = episodeContentType(response.headers.get("content-type"));
  if (!contentType) {
    await cancel(response);
    return { reason: "not_audio", stored: false };
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await cancel(response);
    return { reason: "too_large", stored: false };
  }

  let upload: R2MultipartUpload;
  try {
    upload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType },
    });
  } catch (error) {
    await cancel(response);
    // The key is fenced: its account or card is being deleted.
    if (error instanceof ObjectWriteBlockedError) {
      return { reason: "blocked", stored: false };
    }
    throw error;
  }
  const parts: R2UploadedPart[] = [];
  const reader = response.body.getReader();
  // R2 completes an upload only when every part but the last is one size,
  // so reads of any length are cut into exact parts.
  const part = new Uint8Array(PART_BYTES);
  let fill = 0;
  let total = 0;
  const flush = async (bytes: Uint8Array) => {
    parts.push(await upload.uploadPart(parts.length + 1, bytes.slice()));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        await upload.abort().catch(() => undefined);
        return { reason: "too_large", stored: false };
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const taken = Math.min(PART_BYTES - fill, value.byteLength - offset);
        part.set(value.subarray(offset, offset + taken), fill);
        fill += taken;
        offset += taken;
        if (fill === PART_BYTES) {
          await flush(part);
          fill = 0;
        }
      }
    }
    if (fill > 0) {
      await flush(part.subarray(0, fill));
    }
    if (total === 0) {
      await upload.abort().catch(() => undefined);
      return { reason: "not_audio", stored: false };
    }
    await upload.complete(parts);
  } catch (error) {
    console.warn("[podcastAudio] episode download or upload broke", {
      message: error instanceof Error ? error.message : String(error),
    });
    await reader.cancel().catch(() => undefined);
    await upload.abort().catch(() => undefined);
    return { reason: "blocked", stored: false };
  }
  return { bytes: total, contentType, stored: true };
};
