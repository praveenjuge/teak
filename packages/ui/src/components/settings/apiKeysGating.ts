import type { ApiKeyListItem } from "./ApiKeysDialog";

/**
 * The API Keys settings section is shown once keys have loaded (even when the
 * user has none), so a keyless user can still create their first API key —
 * API keys remain a supported alternative to browser sign-in. It stays hidden
 * only while the list is still loading (`undefined`) to avoid a flash of an
 * empty section.
 *
 * Kept in a dependency-free module so it can be unit-tested without importing
 * the full SettingsContent component graph.
 */
export const shouldShowApiKeysSection = (
  keys: ApiKeyListItem[] | undefined
): boolean => keys !== undefined;
