import { Monitor, Moon, Sun } from "lucide-react";

export const PRO_FEATURES = [
  "Unlimited Cards",
  "Unlimited Storage",
  "Automatic Summary and Tags",
  "Automatic Audio Transcription",
  "Chrome Extension",
  "iOS Mobile App",
  "Android Mobile App",
];

export const THEME_OPTIONS = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];
