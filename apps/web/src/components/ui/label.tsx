import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "../../lib/utils";

function Label({
  className,
  onMouseDown,
  render,
  ...props
}: useRender.ComponentProps<"label">) {
  return useRender({
    defaultTagName: "label",
    render,
    props: mergeProps<"label">(
      {
        className: cn(
          "flex select-none items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50",
          className
        ),
        "data-slot": "label",
        onMouseDown(event) {
          if (
            event.target instanceof Element &&
            event.target.closest("button, input, select, textarea")
          ) {
            return;
          }
          onMouseDown?.(event);
          if (!event.defaultPrevented && event.detail > 1) {
            event.preventDefault();
          }
        },
      } as useRender.ElementProps<"label">,
      props
    ),
  });
}

export { Label };
