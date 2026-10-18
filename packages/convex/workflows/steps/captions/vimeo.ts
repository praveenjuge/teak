import {
  fetchRemoteText,
  type RemoteFetchDeps,
} from "../categorization/remote/common";
import { webVttToTranscript } from "./parse";
import type { CaptionMissReason, CaptionOutcome } from "./types";

// A Vimeo video's captions: the player config lists its text tracks, and
// the chosen track is a WebVTT file. An unlisted video's config needs its
// hash; a private one answers 403.

const VIDEO_ID_REGEX = /^\d{1,12}$/;
const HASH_REGEX = /^[0-9a-f]{6,20}$/i;
const CONFIG_MAX_BYTES = 512 * 1024;
const VTT_MAX_BYTES = 2 * 1024 * 1024;
const TRACK_HOST_SUFFIX = ".vimeo.com";

export interface VimeoVideoRef {
  hash?: string;
  id: string;
}

const isVimeoHost = (hostname: string, host: string) =>
  hostname === host || hostname === `www.${host}`;

// The vimeo.com paths in front of `<id>[/<hash>]`; `*` is any one segment.
const VIDEO_PATH_PREFIXES = [
  [],
  ["channels", "*"],
  ["groups", "*", "videos"],
  ["showcase", "*", "video"],
  ["album", "*", "video"],
];

/**
 * The video in `vimeo.com/<id>[/<hash>]` (also under `/channels/…`,
 * `/groups/…/videos/`, `/showcase/…/video/` or `/album/…/video/`) or
 * `player.vimeo.com/video/<id>`, with the unlisted hash from the path or an
 * `h=` parameter. Null for any other link.
 */
export const parseVimeoUrl = (rawUrl: string): VimeoVideoRef | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  let pathHash: string | undefined;
  if (isVimeoHost(url.hostname, "player.vimeo.com")) {
    if (segments[0] === "video") {
      id = segments[1];
    }
  } else if (isVimeoHost(url.hostname, "vimeo.com")) {
    // Only the paths that name one video; a showcase, album or channel page
    // also ends in digits.
    for (const prefix of VIDEO_PATH_PREFIXES) {
      const rest = segments.slice(prefix.length);
      if (
        prefix.every((part, i) => part === "*" || part === segments[i]) &&
        (rest.length === 1 || rest.length === 2)
      ) {
        id = rest[0];
        pathHash = rest[1];
        break;
      }
    }
  }
  if (!(id && VIDEO_ID_REGEX.test(id))) {
    return null;
  }
  const hash = url.searchParams.get("h") ?? pathHash;
  return hash && HASH_REGEX.test(hash) ? { hash, id } : { id };
};

export const vimeoConfigUrl = ({ hash, id }: VimeoVideoRef): string =>
  `https://player.vimeo.com/video/${id}/config${hash ? `?h=${hash}` : ""}`;

export interface VimeoTextTrack {
  default?: boolean;
  kind?: string;
  label?: string;
  lang?: string;
  provenance?: string;
  url?: string;
}

const isAuto = (track: VimeoTextTrack) =>
  /auto|ai[_-]?generated|asr|machine/i.test(track.provenance ?? "") ||
  /auto-generated/i.test(track.label ?? "");

const isEnglish = (track: VimeoTextTrack) =>
  (track.lang ?? "").toLowerCase().split("-")[0] === "en";

/**
 * The track to read: one a person made before an automatic one; captions
 * (usually the spoken language) before subtitles (usually translations);
 * then English, then the uploader's default, then the first.
 */
export const chooseVimeoTrack = (
  tracks: VimeoTextTrack[]
): VimeoTextTrack | undefined => {
  const usable = tracks.filter((track) => track.url);
  const ranked = [...usable].sort((a, b) => {
    const score = (track: VimeoTextTrack) =>
      (isAuto(track) ? 100 : 0) +
      (track.kind === "captions" ? 0 : 10) +
      languageRank(track);
    return score(a) - score(b);
  });
  return ranked[0];
};

/** A track's URL when it is https on Vimeo; relative ones are the player's. */
export const vimeoTrackUrl = (raw: string | undefined): string | null => {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw, "https://player.vimeo.com");
    return url.protocol === "https:" &&
      (url.hostname === "vimeo.com" || url.hostname.endsWith(TRACK_HOST_SUFFIX))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const blocked = (status: number) =>
  status === 401 || status === 403 || status === 429;

const missReason = (status: number): CaptionMissReason => {
  if (blocked(status)) {
    return "blocked";
  }
  return status === 404 ? "no_captions" : "unreachable";
};

const languageRank = (track: VimeoTextTrack): number => {
  if (isEnglish(track)) {
    return 0;
  }
  return track.default ? 1 : 2;
};

export const fetchVimeoCaptions = async (
  ref: VimeoVideoRef,
  deps: RemoteFetchDeps
): Promise<CaptionOutcome> => {
  const config = await fetchRemoteText(vimeoConfigUrl(ref), deps, {
    accept: "application/json",
    headers: { referer: `https://vimeo.com/${ref.id}` },
    maxBytes: CONFIG_MAX_BYTES,
  });
  if (config.text === null) {
    return { reason: missReason(config.status) };
  }
  let tracks: VimeoTextTrack[];
  try {
    const parsed = JSON.parse(config.text) as {
      request?: { text_tracks?: unknown };
    };
    const list = parsed.request?.text_tracks;
    tracks = Array.isArray(list) ? (list as VimeoTextTrack[]) : [];
  } catch {
    return { reason: "parse_error" };
  }
  const track = chooseVimeoTrack(tracks);
  const trackUrl = vimeoTrackUrl(track?.url);
  if (!(track && trackUrl)) {
    return { reason: "no_captions" };
  }
  const vtt = await fetchRemoteText(trackUrl, deps, {
    accept: "text/vtt",
    maxBytes: VTT_MAX_BYTES,
  });
  if (vtt.text === null) {
    return { reason: blocked(vtt.status) ? "blocked" : "unreachable" };
  }
  let text: string;
  try {
    text = webVttToTranscript(vtt.text);
  } catch {
    return { reason: "parse_error" };
  }
  return text
    ? {
        captions: {
          auto: isAuto(track),
          language: track.lang ?? "und",
          text,
        },
      }
    : { reason: "no_captions" };
};
