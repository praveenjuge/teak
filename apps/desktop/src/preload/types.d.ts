import type { TeakDesktopApi } from "./index";

declare global {
  interface Window {
    teakDesktop: TeakDesktopApi;
  }
}
