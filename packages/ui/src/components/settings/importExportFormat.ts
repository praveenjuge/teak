export { formatBytes } from "@teak/convex/shared/utils/formatBytes";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const relativeDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

/** Human "N minutes/hours/days ago" for recent timestamps, date otherwise. */
export function formatRelativeTime(
  timestamp: number,
  now = Date.now()
): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) {
    return "just now";
  }
  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diff / DAY_MS);
  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return relativeDateFormatter.format(new Date(timestamp));
}

/**
 * Coarse "Xd Yh" / "Yh Zm" countdown for a remaining duration. Days + hours
 * when more than a day out, hours + minutes when under a day.
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "now";
  }
  const totalMinutes = Math.ceil(remainingMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`);
  }
  return parts.length > 0 ? parts.join(" ") : "under a minute";
}
