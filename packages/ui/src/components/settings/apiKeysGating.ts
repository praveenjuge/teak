import type { ApiKeyListItem } from "./ApiKeysDialog";

/**
 * The API Keys settings section is shown only once keys have loaded and the
 * user holds at least one key. New/keyless users are steered to browser
 * sign-in instead, while grandfathered key holders keep full access.
 *
 * Kept in a dependency-free module so it can be unit-tested without importing
 * the full SettingsContent component graph.
 */
export const shouldShowApiKeysSection = (
  keys: ApiKeyListItem[] | undefined
): boolean => keys !== undefined && keys.length > 0;
