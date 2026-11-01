import {
  codePointLength,
  truncateCodePoints,
} from "@teak/convex/shared/utils/codePoints";

const MAX_SHOWN_FOLDER_NAME = 40;

export const clipFolderName = (name: string): string =>
  codePointLength(name) > MAX_SHOWN_FOLDER_NAME
    ? `${truncateCodePoints(name, MAX_SHOWN_FOLDER_NAME - 1).trimEnd()}…`
    : name;
