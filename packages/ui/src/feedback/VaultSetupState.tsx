"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "../logo";

/** What the setup is doing, cycled under the title. */
export const VAULT_SETUP_STEPS = [
  "Adding a few starter cards",
  "Pulling colors from a photo",
  "Writing out a voice memo",
  "Reading a search cheat sheet",
  "Making you a moodboard",
] as const;

const STEP_MS = 1600;

/**
 * Shown to a brand-new account while its getting-started cards are on their
 * way, in place of the empty library, so the first thing it sees fills in.
 */
export function VaultSetupState() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setStep((current) => (current + 1) % VAULT_SETUP_STEPS.length),
      STEP_MS
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      aria-live="polite"
      className="fade-in mx-auto flex max-w-xs animate-in flex-col items-center gap-5 py-20 text-center duration-500 motion-reduce:animate-none"
      role="status"
    >
      <LogoMark className="size-8" />
      <div
        aria-hidden="true"
        className="relative -mt-1 h-0.5 w-30 overflow-hidden rounded-full bg-muted"
      >
        {/* Without motion, the segment rests in the middle of the track. */}
        <span className="absolute inset-y-0 left-0 w-2/5 animate-progress-slide rounded-full bg-foreground motion-reduce:translate-x-3/4 motion-reduce:animate-none" />
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">Setting up your vault</h3>
        <p
          aria-hidden="true"
          className="fade-in slide-in-from-bottom-1 animate-in text-balance text-muted-foreground duration-300 motion-reduce:animate-none"
          key={step}
        >
          {VAULT_SETUP_STEPS[step]}…
        </p>
      </div>
    </div>
  );
}
