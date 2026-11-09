import type { SVGProps } from "react";
import { BrandSvg } from "./BrandSvg";
import { wordmarkPaths } from "./wordmarkPaths";

const LOGO_COLORS = {
  default: "rgba(0,0,0,0.4)",
  primary: "#dc2626",
  current: "currentColor",
  white: "#ffffff",
} as const;

type LogoVariant = keyof typeof LOGO_COLORS;

export interface WordmarkProps extends Omit<SVGProps<SVGSVGElement>, "color"> {
  color?: string;
  title?: string;
  variant?: LogoVariant;
}

export function Wordmark({
  variant = "default",
  width = 64,
  height = 20,
  color,
  title,
  ...svgProps
}: WordmarkProps) {
  const fillColor = color || LOGO_COLORS[variant] || LOGO_COLORS.default;

  return (
    <BrandSvg
      {...svgProps}
      fill={fillColor}
      height={height}
      title={title}
      viewBox="0 0 290 92"
      width={width}
    >
      {wordmarkPaths()}
    </BrandSvg>
  );
}
