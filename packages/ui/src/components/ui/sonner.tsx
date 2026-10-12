"use client";

import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  getToasterBottomOffset,
  useIsBulkActionBarVisible,
} from "../../lib/bulkActionBarPresence";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  // Toasts are full-width bars at the bottom; lift them above the bulk-action
  // bar while it is visible so they never cover its buttons.
  const bottomOffset = getToasterBottomOffset(useIsBulkActionBarVisible());
  const offset = { top: 0, right: 0, bottom: bottomOffset, left: 0 };

  return (
    <Sonner
      className="toaster group"
      mobileOffset={offset}
      offset={offset}
      style={
        {
          "--normal-bg": "var(--primary)",
          "--normal-text": "var(--primary-foreground)",
          "--normal-border": "transparent",
          "--width": "100%",
          "--border-radius": "0px",
        } as CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        className:
          "!rounded-none !shadow-none !border-0 !w-full !max-w-none !items-center !justify-center !text-center",
        descriptionClassName: "!text-primary-foreground !text-center",
        classNames: {
          actionButton: "!order-3",
          cancelButton: "!order-3",
          closeButton:
            "!static !order-2 !ml-0 !size-6 !translate-none !rounded-none !border-0 !bg-transparent !p-0 !text-primary-foreground/70 hover:!border-0 hover:!bg-transparent hover:!text-primary-foreground focus-visible:!outline-none focus-visible:!ring-0 [&_svg]:stroke-3 [&_svg]:size-4 [&_svg]:text-white !transform-none",
          content: "!order-1 !items-center !text-center",
          title: "!text-center",
          icon: "!mx-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
