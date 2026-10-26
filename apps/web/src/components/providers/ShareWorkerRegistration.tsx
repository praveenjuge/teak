"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js`, which only receives shares from the system share sheet
 * once the web app is installed. It runs on every page, so the worker is in
 * place before the first share.
 */
export function ShareWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Without it, shares still reach /share, which keeps their text.
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
