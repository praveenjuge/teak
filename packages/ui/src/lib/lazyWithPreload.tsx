import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from "react";

export type PreloadableComponent<P extends object> = LazyExoticComponent<
  ComponentType<P>
> & {
  /** The component once its code has loaded, or null until then. */
  loaded: () => ComponentType<P> | null;
  /** Starts loading the component's code; resolves once it can render. */
  preload: () => Promise<unknown>;
};

/**
 * `React.lazy` that can also be loaded ahead of its first render, so code
 * kept out of the first page load is ready by the time someone needs it.
 * A failed load is forgotten, so the next render or preload tries again.
 *
 * Render `loaded()` when it is set instead of the lazy component: a lazy
 * component suspends on its first render even when its code is already
 * here, and React then holds back its content for up to 300 ms.
 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>
): PreloadableComponent<P> {
  let loading: Promise<{ default: ComponentType<P> }> | null = null;
  let component: ComponentType<P> | null = null;
  const preload = () => {
    loading ??= load().then(
      (loadedComponent) => {
        component = loadedComponent;
        return { default: loadedComponent };
      },
      (error: unknown) => {
        loading = null;
        throw error;
      }
    );
    return loading;
  };
  return Object.assign(lazy(preload), { loaded: () => component, preload });
}

/**
 * A dialog whose code loads on demand. Nothing renders until it first opens;
 * from then on it stays mounted, so it closes and reopens as before. Until
 * the code arrives it renders `fallback` (nothing by default).
 */
export function onDemand<P extends { open: boolean }>(
  load: () => Promise<ComponentType<P>>,
  fallback?: (props: P) => ReactNode
) {
  const Lazy = lazyWithPreload(load);
  // Chosen at the first open and kept: switching between the lazy and the
  // loaded component later would remount the dialog.
  const pick = () => Lazy.loaded() ?? Lazy;
  function OnDemand(props: P) {
    const [Loaded, setLoaded] = useState<ComponentType<P> | null>(() =>
      props.open ? pick() : null
    );
    if (props.open && !Loaded) {
      setLoaded(pick);
    }
    if (!Loaded) {
      return null;
    }
    return (
      <Suspense fallback={fallback ? fallback(props) : null}>
        <Loaded {...props} />
      </Suspense>
    );
  }
  return Object.assign(OnDemand, { preload: Lazy.preload });
}

/**
 * Runs `callback` once the browser is idle, or after `timeout` ms at the
 * latest (older Safari has no requestIdleCallback). Returns a cancel function.
 */
export function whenIdle(callback: () => void, timeout = 2000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, Math.min(timeout, 200));
  return () => window.clearTimeout(handle);
}
