"use client";

import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  // Toasts are small pills centered at the bottom of the content column
  // (beside the app sidebar), or of the window while a dialog is open; the
  // layout lives with the --teak-toast-* tokens in styles.css. The
  // bulk-action bar uses the top edge, so neither covers the other.
  return (
    <Sonner
      className="toaster group"
      gap={8}
      mobileOffset={16}
      offset={24}
      style={
        {
          "--normal-bg": "var(--teak-toast-bg)",
          "--normal-text": "var(--teak-toast-text)",
          "--normal-border": "var(--teak-toast-border)",
          "--width": "min(28rem, calc(100vw - 2rem))",
        } as CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          toast:
            "!gap-2.5 !font-medium !text-sm !leading-5 !shadow-[0_8px_24px_-6px_rgb(0_0_0/0.3),0_2px_6px_-2px_rgb(0_0_0/0.15)]",
          title: "!font-medium",
          description: "!font-normal !text-(--teak-toast-text)/65",
          icon: "!m-0 !size-4 text-(--teak-toast-muted)",
          success: "[&_[data-icon]]:!text-(--teak-toast-success)",
          error: "[&_[data-icon]]:!text-(--teak-toast-error)",
          actionButton:
            "!order-3 !ml-1 !h-7 !rounded-full !bg-(--teak-toast-text)/12 !px-3 !font-medium !text-(--teak-toast-text) !text-xs hover:!bg-(--teak-toast-text)/20",
          cancelButton:
            "!order-3 !h-7 !rounded-full !bg-transparent !px-3 !font-medium !text-(--teak-toast-text)/65 !text-xs hover:!text-(--teak-toast-text)",
          closeButton:
            "!static !order-4 !size-6 !shrink-0 !transform-none !rounded-full !border-0 !bg-transparent !text-(--teak-toast-text)/55 hover:!bg-(--teak-toast-text)/12 hover:!text-(--teak-toast-text) [&_svg]:!size-3.5",
          content: "!order-1",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
