// Long enough for a page's first data to arrive on a slow connection; after
// that the person has moved on and a jump would surprise them.
export const SCROLL_RESTORE_GIVE_UP_MS = 5000;

// Input that means the person is scrolling or acting on the page themselves.
const USER_INPUT_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
] as const;

const NOOP = () => undefined;

function maxScrollTop() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

/**
 * Scrolls the window to `top` as soon as the page is tall enough to get
 * there. A page that is still loading can be shorter than the position it is
 * asked to return to, and the browser then clamps the scroll to what fits.
 * This waits for the content to grow instead, and gives up when the person
 * scrolls or acts first, or after SCROLL_RESTORE_GIVE_UP_MS. Returns a
 * function that stops waiting.
 */
export function scrollWhenReachable(top: number, left = 0): () => void {
  if (Math.abs(window.scrollY - top) <= 1) {
    return NOOP;
  }
  if (maxScrollTop() >= top) {
    window.scrollTo({ top, left });
    return NOOP;
  }
  let stopped = false;
  const observer = new ResizeObserver(() => {
    if (maxScrollTop() >= top) {
      stop();
      window.scrollTo({ top, left });
    }
  });
  const timer = setTimeout(() => stop(), SCROLL_RESTORE_GIVE_UP_MS);
  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    for (const type of USER_INPUT_EVENTS) {
      window.removeEventListener(type, stop, true);
    }
  }
  observer.observe(document.body);
  for (const type of USER_INPUT_EVENTS) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  return stop;
}
