import { imageSize } from "image-size";

export const MAX_REMOTE_IMAGE_PIXELS = 32 * 1024 * 1024;

export const readRemoteImageDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  try {
    const { height, width } = imageSize(bytes);
    if (!(height && width) || width > MAX_REMOTE_IMAGE_PIXELS / height) {
      return null;
    }
    return { height, width };
  } catch {
    return null;
  }
};
