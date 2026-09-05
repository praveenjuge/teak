import type { Page } from "@playwright/test";

type ObservedWindow = Window & {
  stopNavigationObservation?: () => NavigationObservation;
};

export interface NavigationObservation {
  elapsedMs: number;
  loading: string[];
}

/** Observe the whole transition, including loading that disappears before readiness. */
export async function observeNavigation(
  page: Page,
  navigate: () => Promise<unknown>,
  waitUntilReady: () => Promise<unknown>
): Promise<NavigationObservation> {
  await page.evaluate(() => {
    const loading = new Set<string>();
    const startedAt = performance.now();
    let frame = 0;
    const sample = () => {
      for (const element of document.querySelectorAll(
        '[data-slot="page-loading"], [role="status"][aria-label="Loading cards"]'
      )) {
        if (element.checkVisibility({ visibilityProperty: true })) {
          loading.add(element.getAttribute("aria-label") ?? "Loading");
        }
      }
    };
    const tick = () => {
      sample();
      frame = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    frame = requestAnimationFrame(tick);
    (window as ObservedWindow).stopNavigationObservation = () => {
      sample();
      observer.disconnect();
      cancelAnimationFrame(frame);
      return {
        elapsedMs: performance.now() - startedAt,
        loading: [...loading],
      };
    };
  });
  await navigate();
  await waitUntilReady();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
  return await page.evaluate(() => {
    const observedWindow = window as ObservedWindow;
    const result = observedWindow.stopNavigationObservation?.() ?? {
      elapsedMs: Number.POSITIVE_INFINITY,
      loading: ["Navigation observer stopped unexpectedly"],
    };
    observedWindow.stopNavigationObservation = undefined;
    return result;
  });
}
