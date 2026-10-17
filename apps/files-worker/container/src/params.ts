import { badRequest } from "./errors";

const INTEGER = /^\d{1,9}$/;

export function intParam(
  query: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = query.get(name);
  if (raw === null) {
    return fallback;
  }
  if (!INTEGER.test(raw)) {
    throw badRequest(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw badRequest(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function peakCountsParam(query: URLSearchParams): number[] {
  const raw = query.get("peaks") ?? "45,200";
  const parts = raw.split(",");
  if (parts.length < 1 || parts.length > 4) {
    throw badRequest("peaks takes one to four counts");
  }
  const counts = parts.map((part) => {
    if (!INTEGER.test(part)) {
      throw badRequest("peaks must be integers");
    }
    const value = Number(part);
    if (value < 1 || value > 1000) {
      throw badRequest("each peaks count must be between 1 and 1000");
    }
    return value;
  });
  if (new Set(counts).size !== counts.length) {
    throw badRequest("peaks counts must be distinct");
  }
  return counts;
}

export type WhisperMode = "auto" | "never" | "always";
const WHISPER_MODES: readonly WhisperMode[] = ["auto", "never", "always"];

export function whisperParam(query: URLSearchParams): WhisperMode {
  const raw = query.get("whisper") ?? "auto";
  const mode = WHISPER_MODES.find((candidate) => candidate === raw);
  if (!mode) {
    throw badRequest("whisper must be auto, never or always");
  }
  return mode;
}

export interface VideoParams {
  frameMax: number;
  scrubFrames: number;
  scrubMax: number;
}

export function videoParams(query: URLSearchParams): VideoParams {
  return {
    frameMax: intParam(query, "frameMax", 1600, 64, 4096),
    scrubFrames: intParam(query, "scrubFrames", 10, 0, 20),
    scrubMax: intParam(query, "scrubMax", 360, 64, 720),
  };
}

export interface AnimationParams {
  frames: number;
}

export function animationParams(query: URLSearchParams): AnimationParams {
  return { frames: intParam(query, "frames", 8, 1, 16) };
}

export interface AudioParams {
  peaks: number[];
  whisper: WhisperMode;
}

export function audioParams(query: URLSearchParams): AudioParams {
  return { peaks: peakCountsParam(query), whisper: whisperParam(query) };
}

export interface PdfPageParams {
  max: number;
  /** The page to draw: the thumbnail is page 1, text reading goes to 3. */
  page: number;
}

export function pdfPageParams(query: URLSearchParams): PdfPageParams {
  return {
    max: intParam(query, "max", 1600, 64, 4096),
    page: intParam(query, "page", 1, 1, 3),
  };
}

export interface PdfTextParams {
  maxChars: number;
  maxPages: number;
}

export function pdfTextParams(query: URLSearchParams): PdfTextParams {
  return {
    maxPages: intParam(query, "maxPages", 50, 1, 500),
    maxChars: intParam(query, "maxChars", 524_288, 1, 4_194_304),
  };
}
