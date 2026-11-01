"use client";

import { useTranslations } from "@teak/i18n/react";

export const MAIN_CONTENT_ID = "main-content";

/**
 * The first stop for Tab: jumps past the sidebar's links and folders to the
 * page itself. Hidden until focused.
 */
export function SkipToContent() {
  const t = useTranslations("appShell");
  return (
    <a
      className="sr-only rounded-full bg-background px-4 py-2 font-medium text-sm shadow-md outline-none focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100] focus-visible:ring-[3px] focus-visible:ring-ring"
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (!main) {
          return;
        }
        // Moves focus without adding a hash to the URL, which holds the
        // library's search. `main` takes focus only for this jump, so a click
        // inside the page doesn't focus it; the next Tab goes to the page's
        // first control.
        event.preventDefault();
        main.setAttribute("tabindex", "-1");
        main.addEventListener("blur", () => main.removeAttribute("tabindex"), {
          once: true,
        });
        main.focus();
      }}
    >
      {t("skipToContent")}
    </a>
  );
}
