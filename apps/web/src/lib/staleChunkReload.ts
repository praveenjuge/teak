const RELOADED_AT_KEY = "teak:stale-chunk-reload";
// A second failure this soon after a reload is a real outage, not a deploy,
// so the page stays and shows its error instead of reloading in a loop.
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * A tab opened before a deploy asks for code-split files the new deploy no
 * longer has. Vite reports that as `vite:preloadError`; reloading once loads
 * the new deploy's files.
 */
export function reloadOnStaleChunk(
  target: Pick<
    Window,
    "addEventListener" | "location" | "sessionStorage"
  > = window,
  now: () => number = Date.now
) {
  target.addEventListener("vite:preloadError", (event) => {
    let last: number | null = null;
    try {
      last = Number(target.sessionStorage.getItem(RELOADED_AT_KEY)) || null;
    } catch {
      // Storage can be blocked; a reload is still the best answer.
    }
    if (last !== null && now() - last < RELOAD_COOLDOWN_MS) {
      return;
    }
    try {
      target.sessionStorage.setItem(RELOADED_AT_KEY, String(now()));
    } catch {
      // As above.
    }
    event.preventDefault();
    target.location.reload();
  });
}
