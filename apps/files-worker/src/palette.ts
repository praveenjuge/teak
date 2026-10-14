import { PhotonImage } from "@cf-wasm/photon";
// Shared with the media renderer, whose image is built from container/ alone.
import { extractPalette } from "../container/src/palette";

/** Main colors of a PNG (`#RRGGBB`, largest share first). */
export const paletteFromPng = (bytes: Uint8Array): string[] => {
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return extractPalette(image.get_raw_pixels()).map((swatch) => swatch.hex);
  } finally {
    image.free();
  }
};
