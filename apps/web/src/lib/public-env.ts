import { TEAK_FILES_ORIGINS } from "@teak/convex/shared/filesOrigins";

const missing = (name: string, local: string): Error =>
  new Error(
    `Missing ${name} environment variable (run: bun run setup, expected ${local} locally)`
  );

export const readConvexUrl = (): string | undefined =>
  process.env.NEXT_PUBLIC_CONVEX_URL;

/** A self-hosted deployment's files host; Teak's own when unset. */
export const readFilesBase = (): string | undefined =>
  process.env.NEXT_PUBLIC_FILES_BASE;

/** The origin card files load from, for the page to connect to early. */
export const filesOrigin = (): string => {
  const base = readFilesBase();
  try {
    return base ? new URL(base).origin : TEAK_FILES_ORIGINS.production;
  } catch {
    return TEAK_FILES_ORIGINS.production;
  }
};

export const getConvexUrl = (): string => {
  const url = readConvexUrl();
  if (!url) {
    throw missing("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
  }
  return url;
};
