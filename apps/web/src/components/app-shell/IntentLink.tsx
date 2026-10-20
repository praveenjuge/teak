"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { prewarmRouteQueries } from "../providers/ConvexClientProvider";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

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
