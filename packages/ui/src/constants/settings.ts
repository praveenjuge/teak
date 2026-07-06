import { Monitor, Moon, Sun } from "lucide-react";

export const PRO_FEATURES = [
  "Unlimited Cards",
  "Unlimited Storage",
  "Automatic Summary and Tags",
  "Automatic Audio Transcription",
  "Browser Extensions",
  "iOS Mobile App",
  "API & MCP Access"
];

export const THEME_OPTIONS = [
  { value: "system", label: "system", icon: Monitor },
  { value: "light", label: "light", icon: Sun },
  { value: "dark", label: "dark", icon: Moon },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];
