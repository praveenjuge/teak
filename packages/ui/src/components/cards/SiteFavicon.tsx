import { Globe } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { getFaviconUrl } from "./cardDisplay";

/** A site's favicon, or a globe when it has none or it fails to load. */
export function SiteFavicon({
  className,
  hostname,
}: {
  className?: string;
  hostname?: string;
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const src = getFaviconUrl(hostname);
  if (!src || failedFor === src) {
    return (
      <Globe
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
      />
    );
  }
  return (
    // biome-ignore lint/correctness/useImageSize: sized by its class
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a failed load swaps in the globe; the image isn't interactive
    <img
      alt=""
      className={cn("size-3.5 shrink-0 rounded-[3px]", className)}
      decoding="async"
      loading="lazy"
      onError={() => setFailedFor(src)}
      src={src}
    />
  );
}
