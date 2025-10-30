"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

export default function AlphaBanner() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem("alpha-banner-dismissed");
    if (dismissed === "true") {
      setIsVisible(false);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem("alpha-banner-dismissed", "true");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div
      className="flex min-h-7 items-center justify-center px-4 text-center text-xs font-semibold uppercase text-primary
       bg-[repeating-linear-gradient(-45deg,var(--color-red-50)_0px,var(--color-red-50)_10px,transparent_10px,transparent_20px)]
       dark:bg-[repeating-linear-gradient(-45deg,var(--color-gray-900)_0px,var(--color-gray-900)_10px,transparent_10px,transparent_20px)] relative
      "
    >
      <span>Super Early Build • Things Might Break</span>
      <button
        onClick={handleClose}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded"
        aria-label="Close banner"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
