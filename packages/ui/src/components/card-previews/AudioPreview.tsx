import type { Doc } from "@teak/convex/_generated/dataModel";
import { Button } from "@teak/ui/components/ui/button";
import { Pause, Play, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import {
  AUDIO_WAVE_BAR_WIDTH_PX,
  AUDIO_WAVE_BARS,
  getAudioWaveHeight,
} from "../cards/previews/AudioWavePreview";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface AudioPreviewProps {
  card: CardWithUrls;
}

export function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPreview({ card }: AudioPreviewProps) {
  const fileUrl = card.fileUrl;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Browser recordings (WebM) often report an unknown duration until fully
  // buffered, so start from the duration stored at upload.
  const [duration, setDuration] = useState(card.fileMetadata?.duration ?? 0);
  const [loadFailed, setLoadFailed] = useState(false);

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const playedBars = Math.round(progress * AUDIO_WAVE_BARS);
  const hasStarted = currentTime > 0 || isPlaying;
  let timeLabel = "";
  if (duration > 0) {
    timeLabel = hasStarted
      ? `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`
      : formatAudioTime(duration);
  } else if (hasStarted) {
    timeLabel = formatAudioTime(currentTime);
  }

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  };

  const syncDuration = () => {
    const value = audioRef.current?.duration;
    if (value !== undefined && Number.isFinite(value) && value > 0) {
      setDuration(value);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-2">
      <div className="w-full max-w-xl space-y-3">
        {fileUrl && (
          <div className="flex h-16 items-center gap-3 rounded-full border bg-card py-2 pr-5 pl-2.5">
            <Button
              aria-label={isPlaying ? "Pause" : "Play"}
              className="size-11"
              disabled={loadFailed}
              onClick={togglePlayback}
              size="icon"
              type="button"
            >
              {isPlaying ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </Button>

            <div className="relative flex h-10 min-w-0 flex-1 items-center justify-between rounded-full has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50">
              {Array.from({ length: AUDIO_WAVE_BARS }, (_, i) => (
                <span
                  aria-hidden="true"
                  className={`rounded-full transition-colors ${
                    i < playedBars ? "bg-primary" : "bg-muted-foreground"
                  }`}
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars use cardId + index for stable keys
                  key={`${card._id}-bar-${i}`}
                  style={{
                    width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
                    height: getAudioWaveHeight(card._id, i),
                  }}
                />
              ))}
              <input
                aria-label="Seek"
                aria-valuetext={`${formatAudioTime(currentTime)} of ${formatAudioTime(duration)}`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                disabled={loadFailed || duration <= 0}
                max={duration || 0}
                min={0}
                onChange={(e) => {
                  const audio = audioRef.current;
                  const value = Number(e.target.value);
                  if (audio) {
                    audio.currentTime = value;
                  }
                  setCurrentTime(value);
                }}
                step="any"
                type="range"
                value={Math.min(currentTime, duration || 0)}
              />
            </div>

            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {timeLabel}
            </span>

            {/* biome-ignore lint/a11y/useMediaCaption: voice recordings have no caption track; the AI transcript below serves that role */}
            <audio
              hidden
              onDurationChange={syncDuration}
              onEnded={(e) => {
                // Recordings without a stored duration learn it on first play.
                const playedTo = e.currentTarget.currentTime;
                setDuration((value) => (value > 0 ? value : playedTo));
                setIsPlaying(false);
                setCurrentTime(0);
              }}
              onError={() => {
                setLoadFailed(true);
                setIsPlaying(false);
              }}
              onLoadedMetadata={syncDuration}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              preload="metadata"
              ref={audioRef}
              src={fileUrl}
            />
          </div>
        )}

        {loadFailed ? (
          <p className="px-3 text-muted-foreground text-sm" role="status">
            This recording couldn't be loaded. Try downloading it instead.
          </p>
        ) : (
          card.fileMetadata?.fileName && (
            <p className="truncate px-3 text-muted-foreground text-sm">
              {card.fileMetadata.fileName}
            </p>
          )
        )}
      </div>

      {card.aiTranscript && (
        <div className="w-full max-w-xl rounded-xl border bg-background">
          <div className="flex w-full items-center gap-2 px-3 pt-3 text-left">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium">Transcript</span>
          </div>

          <div className="max-h-64 overflow-y-auto p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {card.aiTranscript}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
