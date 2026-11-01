import {
  BookmarkCheck,
  Check,
  Info,
  LoaderCircle,
  Sparkles,
  type VadivamIcon,
  X,
} from "vadivam-react";
import type { PopupTone } from "../../lib/popupStatus";

/**
 * How each status tone looks: `chip` for the round badge of a status with
 * nothing to preview, `text` for the status line above a saved page or file.
 */
export const TONES: Record<
  PopupTone,
  { chip: string; icon: VadivamIcon; text: string }
> = {
  error: {
    chip: "bg-destructive/10 text-destructive ring-destructive/5",
    icon: X,
    text: "text-destructive",
  },
  existing: {
    chip: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/5 dark:text-emerald-400",
    icon: BookmarkCheck,
    text: "text-emerald-600 dark:text-emerald-400",
  },
  info: {
    chip: "bg-muted text-muted-foreground ring-muted/50",
    icon: Info,
    text: "text-muted-foreground",
  },
  loading: {
    chip: "bg-primary/10 text-primary ring-primary/5 [&>svg]:animate-spin",
    icon: LoaderCircle,
    text: "text-foreground [&>svg]:text-primary",
  },
  success: {
    chip: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/5 dark:text-emerald-400",
    icon: Check,
    text: "text-emerald-600 dark:text-emerald-400",
  },
  upgrade: {
    chip: "bg-amber-500/10 text-amber-600 ring-amber-500/5 dark:text-amber-400",
    icon: Sparkles,
    text: "text-amber-600 dark:text-amber-400",
  },
};
