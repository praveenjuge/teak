import { buildWebUrl, getDesktopConfig } from "@/lib/desktop-config";

export { buildWebUrl };

export function getWebUrl(): string {
  return getDesktopConfig().webBaseUrl;
}

export function getSignUpUrl(): string {
  return buildWebUrl("/register");
}

export function getForgotPasswordUrl(): string {
  return buildWebUrl("/forgot-password");
}

export function getCardViewUrl(cardId: string): string {
  return buildWebUrl(`/card/${cardId}`);
}
