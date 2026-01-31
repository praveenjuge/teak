"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      className="toaster group"
      mobileOffset={0}
      offset={0}
      style={
        {
          "--normal-bg": "var(--primary)",
          "--normal-text": "var(--primary-foreground)",
          "--normal-border": "transparent",
          "--width": "100%",
          "--border-radius": "0px",
        } as React.CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        className:
          "!rounded-none !shadow-none !border-0 !w-full !max-w-none !items-center !justify-center !text-center",
        descriptionClassName: "!text-primary-foreground !text-center",
        classNames: {
          content: "!items-center !text-center",
          title: "!text-center",
          icon: "!mx-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
