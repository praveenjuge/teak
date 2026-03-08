/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API Key - Generate in Teak Settings > API Keys, then paste it here. */
  apiKey: string;
};

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences;

declare namespace Preferences {
  /** Preferences accessible in the `quick-save` command */
  export type QuickSave = ExtensionPreferences & {};
  /** Preferences accessible in the `search-cards` command */
  export type SearchCards = ExtensionPreferences & {};
  /** Preferences accessible in the `favorites` command */
  export type Favorites = ExtensionPreferences & {};
}

declare namespace Arguments {
  /** Arguments passed to the `quick-save` command */
  export type QuickSave = {};
  /** Arguments passed to the `search-cards` command */
  export type SearchCards = {};
  /** Arguments passed to the `favorites` command */
  export type Favorites = {};
}
