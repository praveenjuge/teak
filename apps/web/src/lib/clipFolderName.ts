import {
  codePointLength,
  truncateCodePoints,
} from "@teak/convex/shared/utils/codePoints";

const MAX_SHOWN_FOLDER_NAME = 40;

/**
 * A folder name short enough for a toast or a placeholder. Names can be 300
 * characters, which would stretch a toast across the screen.
 */
export const clipFolderName = (name: string): string =>
  codePointLength(name) > MAX_SHOWN_FOLDER_NAME
    ? `${truncateCodePoints(name, MAX_SHOWN_FOLDER_NAME - 1).trimEnd()}…`
    : name;
