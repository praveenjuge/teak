import { AUDIO_WAVE_BARS, getAudioWaveHeight } from "@teak/ui/lib/audioWave";
import { Play } from "lucide-react";
import { CARD_SURFACE } from "../cardDisplay";

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
  title?: string;
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
      {title || durationLabel ? (
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
          {durationLabel ? (
            <span className="shrink-0 tabular-nums">{durationLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { AUDIO_WAVE_BARS, getAudioWaveHeight } from "@teak/ui/lib/audioWave";
export {
  AUDIO_WAVE_BAR_WIDTH_PX,
  AUDIO_WAVE_DETAIL_BARS,
  getWaveformBarHeights,
  isWaveformBars,
};
