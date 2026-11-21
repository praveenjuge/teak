import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "../../lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  const direction = orientation === "vertical" ? "vertical" : "horizontal";
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        "aria-orientation":
          !decorative && direction === "vertical" ? direction : undefined,
        className: cn(
          "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
          className
        ),
        "data-orientation": direction,
        "data-slot": "separator",
        role: decorative ? "none" : "separator",
      } as useRender.ElementProps<"div">,
      props
    ),
  });
}

export { Separator };
