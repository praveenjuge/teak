export type SocialProvider = "google" | "apple";

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  apple: "Apple",
  google: "Google",
};

/**
 * True when a social sign-in failure means the provider is not configured
 * on the backend (unregistered provider, or the provider factory reporting
 * a missing capability group).
 */
export const isProviderNotConfiguredMessage = (message: string): boolean =>
  /provider not found|not configured on this deployment|PROVIDER_NOT_FOUND/i.test(
    message
  );

/**
 * Map a raw social sign-in failure to the message shown in the UI. The
 * social buttons stay visible even when the backend capability is absent,
 * so an unconfigured provider gets a clear action-oriented message.
 */
export const socialSignInErrorMessage = (
  provider: SocialProvider,
  message: string | undefined,
  fallback: string
): string => {
  if (message && isProviderNotConfiguredMessage(message)) {
    return (
      `${PROVIDER_LABEL[provider]} sign-in isn't available on this server ` +
      "yet. Use email instead."
    );
  }
  return message ?? fallback;
};
