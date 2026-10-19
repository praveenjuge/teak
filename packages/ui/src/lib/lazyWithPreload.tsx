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
  loaded: () => ComponentType<P> | null;
  preload: () => Promise<unknown>;
};

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * React.lazy keeps a failed load for good, so this load retries instead
 * while the Suspense fallback stays up. A lazy component also suspends on its
 * first render when its code is already here, and React then holds back its
 * content for up to 300 ms: render `loaded()` when it is set.
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
  const loadUntilLoaded = () =>
    new Promise<{ default: ComponentType<P> }>((resolve) => {
      const attempt = (delay: number) => {
        preload().then(resolve, () => {
          if (typeof window === "undefined") {
            return;
          }
          const retry = () => {
            window.clearTimeout(timeout);
            window.removeEventListener("online", retry);
            attempt(Math.min(delay * 2, MAX_RETRY_MS));
          };
          const timeout = window.setTimeout(retry, delay);
          window.addEventListener("online", retry);
        });
      };
      attempt(FIRST_RETRY_MS);
    });
  return Object.assign(lazy(loadUntilLoaded), {
    loaded: () => component,
    preload,
  });
}

export function onDemand<P extends { open: boolean }>(
  load: () => Promise<ComponentType<P>>,
  fallback?: (props: P) => ReactNode
) {
  const Lazy = lazyWithPreload(load);
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

// Older Safari has no requestIdleCallback.
export function whenIdle(callback: () => void, timeout = 2000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, Math.min(timeout, 200));
  return () => window.clearTimeout(handle);
}
