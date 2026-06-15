/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API Key - Generate in Teak Settings > Manage API Keys, then paste it here. */
  "apiKey": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `quick-save` command */
  export type QuickSave = ExtensionPreferences & {}
  /** Preferences accessible in the `save-text` command */
  export type SaveText = ExtensionPreferences & {}
  /** Preferences accessible in the `save-clipboard-url` command */
  export type SaveClipboardUrl = ExtensionPreferences & {}
  /** Preferences accessible in the `save-selected-text` command */
  export type SaveSelectedText = ExtensionPreferences & {}
  /** Preferences accessible in the `save-current-browser-tab` command */
  export type SaveCurrentBrowserTab = ExtensionPreferences & {}
  /** Preferences accessible in the `search-cards` command */
  export type SearchCards = ExtensionPreferences & {}
  /** Preferences accessible in the `favorites` command */
  export type Favorites = ExtensionPreferences & {}
  /** Preferences accessible in the `tags` command */
  export type Tags = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `quick-save` command */
  export type QuickSave = {}
  /** Arguments passed to the `save-text` command */
  export type SaveText = {
  /** Text or URL */
  "content": string
}
  /** Arguments passed to the `save-clipboard-url` command */
  export type SaveClipboardUrl = {}
  /** Arguments passed to the `save-selected-text` command */
  export type SaveSelectedText = {}
  /** Arguments passed to the `save-current-browser-tab` command */
  export type SaveCurrentBrowserTab = {}
  /** Arguments passed to the `search-cards` command */
  export type SearchCards = {}
  /** Arguments passed to the `favorites` command */
  export type Favorites = {}
  /** Arguments passed to the `tags` command */
  export type Tags = {}
}

