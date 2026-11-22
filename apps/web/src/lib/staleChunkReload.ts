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
    // The reload is only safe when its time can be kept: without it, a chunk
    // that is really gone would reload the tab forever. Blocked storage
    // leaves Vite's error to the page's error screen instead.
    try {
      const last = Number(target.sessionStorage.getItem(RELOADED_AT_KEY));
      if (last && now() - last < RELOAD_COOLDOWN_MS) {
        return;
      }
      target.sessionStorage.setItem(RELOADED_AT_KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    target.location.reload();
  });
}
