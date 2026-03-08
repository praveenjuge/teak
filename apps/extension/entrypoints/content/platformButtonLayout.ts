import type { Platform } from "../../types/social";

type InlineSaveButtonPosition = {
  bottom: string;
  left: string;
  right: string;
  top: string;
};

const INLINE_SAVE_BUTTON_POSITIONS: Record<Platform, InlineSaveButtonPosition> =
  {
    x: {
      top: "auto",
      right: "auto",
      bottom: "8px",
      left: "8px",
    },
    instagram: {
      top: "54px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    },
    pinterest: {
      top: "64px",
      right: "12px",
      bottom: "auto",
      left: "auto",
    },
    hackernews: {
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    },
    sidebar: {
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    },
    webdesignernews: {
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    },
    heydesigner: {
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    },
  };

export const getInlineSaveButtonPosition = (
  platform: Platform
): InlineSaveButtonPosition => INLINE_SAVE_BUTTON_POSITIONS[platform];
