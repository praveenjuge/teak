/** Container detection for upload verification: map head bytes to candidate formats. */

import {
  fontFormatOf,
  isAacAdts,
  isAsf,
  isAvi,
  isBmp,
  isEbml,
  isFlac,
  isGif,
  isIsobmff,
  isJpeg,
  isMatroska,
  isMp3,
  isMpegPs,
  isMpegTs,
  isOgg,
  isOle,
  isobmffBrand,
  isPdf,
  isPng,
  isTiff,
  isWav,
  isWebm,
  isWebp,
} from "./mediaFacts";

export interface Detection {
  formatIds: string[];
  kind: string;
  mimeType: string;
}

export const detectContainer = (head: Uint8Array): Detection | null => {
  if (isPng(head)) {
    return { formatIds: ["png"], kind: "image", mimeType: "image/png" };
  }
  if (isJpeg(head)) {
    return { formatIds: ["jpeg"], kind: "image", mimeType: "image/jpeg" };
  }
  if (isGif(head)) {
    return { formatIds: ["gif"], kind: "motion", mimeType: "image/gif" };
  }
  if (isWebp(head)) {
    return { formatIds: ["webp"], kind: "image", mimeType: "image/webp" };
  }
  if (isBmp(head)) {
    return { formatIds: ["bitmap"], kind: "image", mimeType: "image/bmp" };
  }
  if (isTiff(head)) {
    return { formatIds: ["bitmap"], kind: "image", mimeType: "image/tiff" };
  }
  if (isIsobmff(head)) {
    const brand = isobmffBrand(head);
    if (brand === "avif") {
      return { formatIds: ["avif"], kind: "image", mimeType: "image/avif" };
    }
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "hevc" ||
      brand === "hevx"
    ) {
      return { formatIds: ["heic"], kind: "image", mimeType: "image/heic" };
    }
    if (brand === "qt  ") {
      return {
        formatIds: ["quicktime"],
        kind: "motion",
        mimeType: "video/quicktime",
      };
    }
    if (brand === "M4A " || brand === "M4B ") {
      return {
        formatIds: ["mp4-audio"],
        kind: "audio",
        mimeType: "audio/mp4",
      };
    }
    // Generic ISO-BMFF brands (isom/mp41/...) ship in both video and audio
    // files; the extension claim disambiguates within the family.
    return {
      formatIds: ["mp4", "quicktime", "mp4-audio"],
      kind: "motion",
      mimeType: "video/mp4",
    };
  }
  if (isMatroska(head)) {
    return {
      formatIds: ["video"],
      kind: "motion",
      mimeType: "video/x-matroska",
    };
  }
  if (isWebm(head) || isEbml(head)) {
    return {
      formatIds: ["webm", "webm-audio"],
      kind: "motion",
      mimeType: "video/webm",
    };
  }
  if (isMp3(head)) {
    return { formatIds: ["mpeg-audio"], kind: "audio", mimeType: "audio/mpeg" };
  }
  if (isWav(head)) {
    return { formatIds: ["wave-audio"], kind: "audio", mimeType: "audio/wav" };
  }
  if (isOgg(head)) {
    return { formatIds: ["other-audio"], kind: "audio", mimeType: "audio/ogg" };
  }
  if (isFlac(head)) {
    return {
      formatIds: ["other-audio"],
      kind: "audio",
      mimeType: "audio/flac",
    };
  }
  if (isAacAdts(head)) {
    return { formatIds: ["aac-audio"], kind: "audio", mimeType: "audio/aac" };
  }
  if (isAvi(head)) {
    return {
      formatIds: ["video"],
      kind: "motion",
      mimeType: "video/x-msvideo",
    };
  }
  if (isAsf(head)) {
    return { formatIds: ["video"], kind: "motion", mimeType: "video/x-ms-wmv" };
  }
  if (isMpegTs(head) || isMpegPs(head)) {
    return { formatIds: ["video"], kind: "motion", mimeType: "video/mpeg" };
  }
  if (isPdf(head)) {
    return { formatIds: ["pdf"], kind: "pdf", mimeType: "application/pdf" };
  }
  if (isOle(head)) {
    // Legacy OLE containers share one header; the extension claim selects
    // the subtype and the MIME claim must match it.
    return {
      formatIds: ["word-legacy", "powerpoint-legacy", "excel-legacy"],
      kind: "office",
      mimeType: "application/msword",
    };
  }
  const font = fontFormatOf(head);
  if (font === "truetype") {
    return {
      formatIds: ["font-truetype"],
      kind: "font",
      mimeType: "font/ttf",
    };
  }
  if (font === "opentype") {
    return {
      formatIds: ["font-opentype"],
      kind: "font",
      mimeType: "font/otf",
    };
  }
  if (font === "woff") {
    return { formatIds: ["font-woff"], kind: "font", mimeType: "font/woff" };
  }
  if (font === "woff2") {
    return { formatIds: ["font-woff2"], kind: "font", mimeType: "font/woff2" };
  }
  return null;
};
