import { getPreferenceValues } from "@raycast/api";

// API keys from before browser sign-in still work and take precedence over it.
export const grandfatheredApiKey = (): string | undefined =>
  getPreferenceValues<Preferences>().apiKey?.trim() || undefined;
