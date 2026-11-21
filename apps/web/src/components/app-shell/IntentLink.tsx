import { AppLink, type AppLinkProps } from "@/components/AppLink";
import { prewarmRouteQueries } from "@/lib/convexClient";

/** An app link that starts its page's first queries when someone heads for it. */
export function IntentLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: AppLinkProps) {
  return (
    <AppLink
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
