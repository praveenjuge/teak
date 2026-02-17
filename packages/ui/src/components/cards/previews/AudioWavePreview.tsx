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

interface AudioWavePreviewProps {
  cardId: string;
}

export function AudioWavePreview({ cardId }: AudioWavePreviewProps) {
  return (
    <div className="flex h-14 items-center justify-between space-x-0.5 rounded-xl border bg-card px-4 py-2">
      {Array.from({ length: AUDIO_WAVE_BARS }, (_, i) => (
        <div
          className="rounded-full bg-muted-foreground"
          // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars use cardId + index for stable keys
          key={`${cardId}-bar-${i}`}
          style={{
            width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
            height: getAudioWaveHeight(cardId, i),
          }}
        />
      ))}
    </div>
  );
}

export { AUDIO_WAVE_BARS, AUDIO_WAVE_BAR_WIDTH_PX };
