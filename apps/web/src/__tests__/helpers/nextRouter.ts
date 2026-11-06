import { mock } from "bun:test";

/**
 * Stands in for the App Router, which only a running Next.js app mounts.
 * Import it before the code under test; `routerPush` records where a
 * client-side navigation went.
 */
export const routerPush = mock((_href: string) => undefined);

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({
    back: mock(),
    forward: mock(),
    prefetch: mock(),
    push: routerPush,
    refresh: mock(),
    replace: mock(),
  }),
}));
