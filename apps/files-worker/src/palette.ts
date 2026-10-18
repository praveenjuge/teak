import { PhotonImage } from "@cf-wasm/photon";
import { extractPalette } from "../container/src/palette";

export const paletteFromPng = (bytes: Uint8Array): string[] => {
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return extractPalette(image.get_raw_pixels()).map((swatch) => swatch.hex);
  } finally {
    image.free();
  }
};
