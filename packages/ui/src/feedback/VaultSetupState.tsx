"use client";

import {
  File,
  FileText,
  Link as LinkIcon,
  type LucideIcon,
  Quote,
  Video,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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
const TILE_STAGGER_MS = 110;

const SUNSET = ["#FF6B6B", "#FFA06B", "#FFD93D", "#6BCB77", "#4D96FF"];
const WAVE = [40, 75, 55, 90, 60, 35];

const IconTile = ({ icon: Icon }: { icon: LucideIcon }) => (
  <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
);

/** One tile per getting-started card, in the order they land in the grid. */
const TILES: { content: ReactNode; key: string }[] = [
  { key: "welcome", content: <IconTile icon={FileText} /> },
  {
    key: "image",
    content: (
      <span
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 70%, #FFC080 0%, #FFA050 45%, #FF9040 100%)",
        }}
      />
    ),
  },
  {
    key: "palette",
    content: (
      <span className="absolute inset-0 flex">
        {SUNSET.map((hex) => (
          <span className="flex-1" key={hex} style={{ background: hex }} />
        ))}
      </span>
    ),
  },
  { key: "video", content: <IconTile icon={Video} /> },
  {
    key: "audio",
    content: (
      <span aria-hidden="true" className="flex h-6 items-center gap-0.5">
        {WAVE.map((height, index) => (
          <span
            className="w-1 rounded-full bg-muted-foreground/70"
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed waveform
            key={index}
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
    ),
  },
  { key: "document", content: <IconTile icon={File} /> },
  { key: "quote", content: <IconTile icon={Quote} /> },
  { key: "link", content: <IconTile icon={LinkIcon} /> },
];

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

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
      className="mx-auto flex max-w-xs flex-col items-center gap-7 py-20 text-center"
      role="status"
    >
      <LogoMark className="fade-in size-8 animate-in duration-500 motion-reduce:animate-none" />
      <div aria-hidden="true" className="grid grid-cols-4 gap-2.5">
        {TILES.map((tile, index) => (
          <span
            className="fade-in zoom-in-90 slide-in-from-bottom-2 relative flex size-14 animate-in items-center justify-center overflow-hidden rounded-xl border bg-card fill-mode-both shadow-xs duration-500 motion-reduce:animate-none"
            key={tile.key}
            style={delay(index * TILE_STAGGER_MS)}
          >
            {tile.content}
            {/* A soft glow that ripples across the tiles while we wait. */}
            <span
              className="absolute inset-0 animate-pulse bg-background/60 opacity-0 motion-reduce:hidden"
              style={delay(900 + index * 180)}
            />
          </span>
        ))}
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
