"use node";

import probe from "probe-image-size";

export const MAX_REMOTE_IMAGE_PIXELS = 32 * 1024 * 1024;

export const readRemoteImageDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  try {
    const result = probe.sync(Buffer.from(bytes));
    if (!result) {
      return null;
    }
    const { height, width } = result;
    if (!(height && width) || width > MAX_REMOTE_IMAGE_PIXELS / height) {
      return null;
    }
    return { height, width };
  } catch {
    return null;
  }
};
