import {
  AUDIO_WAVE_BARS,
  getAudioWaveHeight,
} from "@teak/convex/shared/audioWave";
import { Play } from "vadivam-react";
import { cn } from "../../../lib/utils";
import { CARD_BADGE, CARD_TILE } from "../cardDisplay";

const AUDIO_WAVE_BAR_WIDTH_PX = 2;

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
  durationLabel?: string;
  formatBadge?: string;
  textInsets?: string;
  title?: string;
  waveformGrid?: number[];
}

export function AudioWavePreview({
  cardId,
  durationLabel,
  formatBadge,
  textInsets,
  title,
  waveformGrid,
}: AudioWavePreviewProps) {
  const heights = getWaveformBarHeights(cardId, waveformGrid);
  return (
    <div className={cn(CARD_TILE, "flex flex-col p-4 pb-11", textInsets)}>
      {title ? (
        <p
          className="line-clamp-2 break-words font-semibold text-sm leading-snug"
          dir="auto"
        >
          {title}
        </p>
      ) : null}
      <div className="mt-auto flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <Play
            aria-hidden="true"
            className="size-3.5 translate-x-px fill-current"
          />
        </span>
        <div className="flex h-12 min-w-0 flex-1 items-center justify-between gap-px overflow-hidden">
          {heights.map((height, i) => (
            <div
              className="shrink-0 rounded-full bg-foreground/40"
              // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars use cardId + index for stable keys
              key={`${cardId}-bar-${i}`}
              style={{
                width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
                height,
              }}
            />
          ))}
        </div>
      </div>
      {formatBadge || durationLabel ? (
        <span className={CARD_BADGE}>
          {formatBadge}
          {formatBadge && durationLabel ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {durationLabel}
        </span>
      ) : null}
    </div>
  );
}

export {
  AUDIO_WAVE_BARS,
  getAudioWaveHeight,
} from "@teak/convex/shared/audioWave";
export {
  AUDIO_WAVE_BAR_WIDTH_PX,
  AUDIO_WAVE_DETAIL_BARS,
  getWaveformBarHeights,
  isWaveformBars,
};
