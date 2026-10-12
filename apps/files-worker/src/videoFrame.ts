import { probeMedia } from "./mediaProbe";
import { InspectSourceMissing } from "./zip";

/** The slice of the Media Transformations binding this module uses. */
export interface MediaTransformsBinding {
  input: (stream: ReadableStream) => {
    transform: (options: { fit?: string; height?: number; width?: number }) => {
      output: (options: { format?: string; mode: "frame"; time?: string }) => {
        response: () => Promise<Response>;
      };
    };
  };
}

export interface VideoFrameEnv {
  BUCKET: R2Bucket;
  MEDIA?: MediaTransformsBinding;
}

export interface VideoFrameResult {
  durationSeconds: number | null;
  /** Source display size, for the card's aspect ratio. */
  originalHeight: number | null;
  originalWidth: number | null;
  storedBytes: number;
  storedContentType: "image/jpeg";
}

// Media Transformations limits: inputs under 100 MB and 10 minutes, tested
// with H.264 MP4. Other inputs answer UNSUPPORTED so Convex keeps its
// browser renderer for them.
export const MAX_VIDEO_FRAME_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_FRAME_DURATION_SECONDS = 10 * 60;
const MAX_FRAME_DIMENSION = 1600;
const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const H264_SAMPLE_ENTRIES = new Set(["avc1", "avc3"]);

/** Skip the opening frames (often black) the way the browser renderer did. */
export const frameTimeSeconds = (durationSeconds: number | null): number =>
  durationSeconds && durationSeconds >= 2
    ? Math.min(5, Math.max(1, Math.floor(durationSeconds * 0.1)))
    : 0;

export const extractVideoFrame = async (
  env: VideoFrameEnv,
  sourceKey: string,
  destinationKey: string
): Promise<VideoFrameResult> => {
  if (!env.MEDIA) {
    throw new Error("media_binding_unavailable");
  }
  const facts = await probeMedia(env.BUCKET, sourceKey);
  if (
    facts.container === "webm" ||
    !(facts.hasVideo && H264_SAMPLE_ENTRIES.has(facts.videoCodec ?? "")) ||
    (facts.durationSeconds ?? 0) > MAX_VIDEO_FRAME_DURATION_SECONDS
  ) {
    throw new Error("video_format_unsupported");
  }
  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new InspectSourceMissing();
  }
  if (source.size > MAX_VIDEO_FRAME_SOURCE_BYTES) {
    await source.body.cancel();
    throw new Error("source_too_large");
  }
  const response = await env.MEDIA.input(source.body)
    .transform({
      fit: "scale-down",
      height: MAX_FRAME_DIMENSION,
      width: MAX_FRAME_DIMENSION,
    })
    .output({
      format: "jpg",
      mode: "frame",
      time: `${frameTimeSeconds(facts.durationSeconds)}s`,
    })
    .response();
  if (!response.ok) {
    throw new Error("video_frame_failed");
  }
  const frame = new Uint8Array(await response.arrayBuffer());
  if (
    frame.length === 0 ||
    frame.length > MAX_FRAME_BYTES ||
    frame[0] !== 0xff ||
    frame[1] !== 0xd8
  ) {
    throw new Error("video_frame_failed");
  }
  await env.BUCKET.put(destinationKey, frame, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return {
    durationSeconds: facts.durationSeconds,
    originalHeight: facts.height,
    originalWidth: facts.width,
    storedBytes: frame.length,
    storedContentType: "image/jpeg",
  };
};
