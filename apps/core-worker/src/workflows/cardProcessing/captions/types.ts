export interface VideoCaptions {
  /** Made by the site's speech recognition rather than a person. */
  auto: boolean;
  language: string;
  text: string;
}

export type CaptionMissReason =
  | "blocked"
  | "no_captions"
  | "parse_error"
  | "unreachable";

export type CaptionOutcome =
  | { captions: VideoCaptions }
  | { reason: CaptionMissReason };
