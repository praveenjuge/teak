const missing = (name: string, local: string): Error =>
  new Error(
    `Missing ${name} environment variable (run: bun run setup, expected ${local} locally)`
  );

export const readConvexUrl = (): string | undefined =>
  process.env.NEXT_PUBLIC_CONVEX_URL;

export const getConvexUrl = (): string => {
  const url = readConvexUrl();
  if (!url) {
    throw missing("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
  }
  return url;
};
