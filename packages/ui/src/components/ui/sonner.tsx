"use client";

import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  // Toasts are full-width bars at the bottom of the content column (beside
  // the app sidebar, see --teak-content-left); the bulk-action bar uses the
  // top edge, so neither covers the other. Inline, so Sonner's own centered
  // position rule can't win.
  const offset = { top: 0, right: 0, bottom: 0, left: 0 };

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
          left: "var(--teak-toaster-left, 50%)",
          width: "calc(100% - var(--teak-content-left, 0px))",
          transition: "left 200ms linear, width 200ms linear",
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
