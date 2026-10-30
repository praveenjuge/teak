/**
 * `store-onboarding-files` copies the getting-started files the Core Worker
 * ships as static assets (`apps/core-worker/assets/onboarding/`) into a new
 * account. Convex names each file's destination key; the Worker stores a
 * card's files together or not at all.
 */

/** Path of the getting-started files among the Worker's static assets. */
export const FILES_ONBOARDING_ASSET_PATH = "/onboarding/";

/** At most this many files in one call. */
export const FILES_ONBOARDING_MAX_FILES = 32;

export interface FilesOnboardingFile {
  contentType: string;
  key: string;
  /** The file's name under `FILES_ONBOARDING_ASSET_PATH`. */
  source: string;
}

export interface FilesOnboardingCardFiles {
  files: FilesOnboardingFile[];
  onboarding: string;
}

export interface FilesStoreOnboardingFilesParams {
  cards: FilesOnboardingCardFiles[];
}

export type FilesOnboardingCardResult =
  | {
      files: { key: string; size: number }[];
      onboarding: string;
      stored: true;
    }
  | { error: string; onboarding: string; stored: false };

export interface FilesStoreOnboardingFilesResult {
  cards: FilesOnboardingCardResult[];
}

/** A plain file name: no directories, so it can only name a shipped file. */
export const isOnboardingSourceName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 100 &&
  /^[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/u.test(value);
