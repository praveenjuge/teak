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
  /** Real 45-value waveform; hash-based bars are drawn when absent or invalid. */
  waveformGrid?: number[];
}

export function AudioWavePreview({
  cardId,
  waveformGrid,
}: AudioWavePreviewProps) {
  const heights = getWaveformBarHeights(cardId, waveformGrid);
  return (
    <div className="flex h-14 items-center justify-between space-x-0.5 rounded-2xl border bg-card px-4 py-2">
      {heights.map((height, i) => (
        <div
          className="rounded-full bg-muted-foreground"
          // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars use cardId + index for stable keys
          key={`${cardId}-bar-${i}`}
          style={{
            width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
            height,
          }}
        />
      ))}
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
