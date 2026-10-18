import { FILES_TRANSCRIPT_MAX_BYTES } from "@teak/files-protocol";

// Caption files as plain transcript text: cues joined, markup and timings
// dropped, the repeats of rolling auto-captions collapsed, and the whole
// cut at the transcript cap on a word boundary.

const TIMING_ARROW = "-->";
const TAG_REGEX = /<[^>]*>/g;
const WHITESPACE_REGEX = /\s+/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lrm;": "",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
  "&rlm;": "",
  "&#39;": "'",
};
const ENTITY_REGEX = /&(?:amp|gt|lrm|lt|nbsp|quot|rlm|#39);/g;

/** Removes tags until none are left, so a nested one can't reassemble. */
const stripTags = (text: string): string => {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(TAG_REGEX, "");
  } while (current !== previous);
  return current;
};

const cueText = (lines: string[]): string =>
  stripTags(lines.join(" "))
    .replace(ENTITY_REGEX, (entity) => ENTITIES[entity] ?? entity)
    .replace(WHITESPACE_REGEX, " ")
    .trim();

/** Each cue's text from a WebVTT file, in order. Throws on a non-VTT body. */
export const parseWebVtt = (vtt: string): string[] => {
  const body = vtt.replace(/^﻿/, "");
  if (!body.startsWith("WEBVTT")) {
    throw new Error("not_webvtt");
  }
  const cues: string[] = [];
  // Blocks are separated by blank lines; the header, NOTE, STYLE and REGION
  // blocks have no timing line.
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex((line) => line.includes(TIMING_ARROW));
    if (timing === -1) {
      continue;
    }
    const text = cueText(lines.slice(timing + 1));
    if (text) {
      cues.push(text);
    }
  }
  return cues;
};

/**
 * Drops the repeats of rolling captions, where each cue shows the end of the
 * last one and adds a few words: a cue equal to the last, or already inside
 * it, adds nothing; a cue that starts with the end of the last keeps only
 * its new words.
 */
export const collapseRollingCaptions = (cues: string[]): string[] => {
  const kept: string[] = [];
  for (const cue of cues) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(cue);
      continue;
    }
    // Whole words only: "category" doesn't hold the cue "gory".
    if (last === cue || last.endsWith(` ${cue}`)) {
      continue;
    }
    if (cue.startsWith(`${last} `)) {
      kept[kept.length - 1] = cue;
      continue;
    }
    const words = cue.split(" ");
    let overlap = 0;
    for (let size = Math.min(words.length - 1, 30); size > 0; size--) {
      if (last.endsWith(` ${words.slice(0, size).join(" ")}`)) {
        overlap = size;
        break;
      }
    }
    kept.push(overlap > 0 ? words.slice(overlap).join(" ") : cue);
  }
  return kept;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Cut to `maxBytes` of UTF-8 at the last space before the cap. */
export const cutTranscript = (
  text: string,
  maxBytes = FILES_TRANSCRIPT_MAX_BYTES
): string => {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) {
    return text;
  }
  // A character split by the cut decodes as U+FFFD; drop it.
  const cut = decoder.decode(bytes.slice(0, maxBytes)).replace(/\uFFFD+$/, "");
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
};

/** A WebVTT file as one transcript, or "" when it has no words. */
export const webVttToTranscript = (vtt: string): string =>
  cutTranscript(collapseRollingCaptions(parseWebVtt(vtt)).join(" "));
