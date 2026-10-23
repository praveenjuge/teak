/**
 * The background's own count of Teak API requests in the last minute. The API
 * allows 120 a minute per user, and the saved-page badge backs off well
 * before that so saves and the popup keep their share.
 */
const WINDOW_MS = 60_000;
const sentAt: number[] = [];

const prune = (now: number) => {
  while (sentAt.length > 0 && now - sentAt[0] >= WINDOW_MS) {
    sentAt.shift();
  }
};

export function recordApiRequest(now = Date.now()) {
  prune(now);
  sentAt.push(now);
}

export function apiRequestsInLastMinute(now = Date.now()) {
  prune(now);
  return sentAt.length;
}
