"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { prewarmRouteQueries } from "./ConvexClientProvider";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * Next.js `Link` that also warms the destination's Convex queries on intent
 * (hover, focus or touch), not as it scrolls into view: a long folder or tag
 * list would otherwise load every page it shows.
 */
export function IntentLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: IntentLinkProps) {
  return (
    <Link
      href={href}
      onFocus={(event) => {
        prewarmRouteQueries(href);
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        prewarmRouteQueries(href);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        prewarmRouteQueries(href);
        onTouchStart?.(event);
      }}
      {...props}
    />
  );
}
