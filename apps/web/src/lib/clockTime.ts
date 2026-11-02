/**
 * A length or position as a media player shows it: "0:05", "3:07",
 * "1:15:00". Whole seconds, rounded down; anything unknown reads "0:00".
 * Cards, the audio player and the recorder all use it, so a recording's
 * length reads the same everywhere.
 */
export function formatClockTime(seconds: number): string {
  const whole =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, "0")}:${secs}`
    : `${mins}:${secs}`;
}
