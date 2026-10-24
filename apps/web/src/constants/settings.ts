import { Monitor, Moon, Sun } from "vadivam-react";

export const THEME_OPTIONS = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];
