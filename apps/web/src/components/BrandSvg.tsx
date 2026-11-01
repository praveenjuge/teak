import type { SVGProps } from "react";

// Shared by the wordmark and the mark. Each lives in its own module so a
// screen that shows one does not ship the other's path data.
export function BrandSvg({
  children,
  title,
  ...svgProps
}: SVGProps<SVGSVGElement> & { title?: string }) {
  const label = title ?? svgProps["aria-label"];
  if (label === undefined && svgProps["aria-labelledby"] === undefined) {
    return (
      <svg {...svgProps} aria-hidden="true">
        {children}
      </svg>
    );
  }
  return (
    <svg {...svgProps} aria-label={label} role={svgProps.role ?? "img"}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
