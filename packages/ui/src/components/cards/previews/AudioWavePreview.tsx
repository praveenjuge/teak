import { Play } from "lucide-react";
import { CARD_SURFACE } from "../cardDisplay";

const AUDIO_WAVE_BARS = 45;
const AUDIO_WAVE_BAR_WIDTH_PX = 2;
const AUDIO_WAVE_MIN_HEIGHT = 20;
const AUDIO_WAVE_MAX_VARIATION = 60;

function seededRandom(seed: string, index: number): number {
  const hash = seed.split("").reduce((acc, char) => {
    const next = (acc << 5) - acc + char.charCodeAt(0);
    return next & next;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2;
}

function getAudioWaveHeight(seed: string, index: number): string {
  const height =
    seededRandom(seed, index) * AUDIO_WAVE_MAX_VARIATION +
    AUDIO_WAVE_MIN_HEIGHT;
  return `${Number(height.toFixed(3))}%`;
}

const AUDIO_WAVE_DETAIL_BARS = 200;
const REAL_WAVE_MIN_HEIGHT = 10;
const REAL_WAVE_RANGE = 100 - REAL_WAVE_MIN_HEIGHT;

function isWaveformBars(values: unknown, count: number): values is number[] {
  return (
    Array.isArray(values) &&
    values.length === count &&
    values.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100
    )
  );
}

/**
 * Bar heights (CSS percentages). Uses the real waveform when it is exactly
 * `count` finite 0-100 values; otherwise falls back to the card-seeded
 * `AUDIO_WAVE_BARS` placeholder bars, so older cards look as they always did.
 */
function getWaveformBarHeights(
  cardId: string,
  values?: unknown,
  count = AUDIO_WAVE_BARS
): string[] {
  if (isWaveformBars(values, count)) {
    return values.map(
      (value) =>
        `${Number((REAL_WAVE_MIN_HEIGHT + (value / 100) * REAL_WAVE_RANGE).toFixed(3))}%`
    );
  }
  return Array.from({ length: AUDIO_WAVE_BARS }, (_, i) =>
    getAudioWaveHeight(cardId, i)
  );
}

interface AudioWavePreviewProps {
  cardId: string;
  /** How long the recording runs, such as `1:24`. */
  durationLabel?: string;
  /** The recording's name, shown under the waveform. */
  title?: string;
  /** Real 45-value waveform; hash-based bars are drawn when absent or invalid. */
  waveformGrid?: number[];
}

export function AudioWavePreview({
  cardId,
  durationLabel,
  title,
  waveformGrid,
}: AudioWavePreviewProps) {
  const heights = getWaveformBarHeights(cardId, waveformGrid);
  return (
    <div className={`px-4 pt-3 pb-3 ${CARD_SURFACE}`}>
      <div className="flex h-10 items-center justify-between gap-0.5">
        {heights.map((height, i) => (
          <div
            className="rounded-full bg-foreground/45"
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars use cardId + index for stable keys
            key={`${cardId}-bar-${i}`}
            style={{
              width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
              height,
            }}
          />
        ))}
      </div>
      {(title || durationLabel) && (
        <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <Play
              aria-hidden="true"
              className="size-2.5 translate-x-px fill-current"
            />
          </span>
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {title}
          </span>
          {durationLabel && (
            <span className="shrink-0 tabular-nums">{durationLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

export {
  AUDIO_WAVE_BAR_WIDTH_PX,
  AUDIO_WAVE_BARS,
  AUDIO_WAVE_DETAIL_BARS,
  getAudioWaveHeight,
  getWaveformBarHeights,
  isWaveformBars,
};
