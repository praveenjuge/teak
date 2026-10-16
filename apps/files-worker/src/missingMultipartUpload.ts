export const isMissingMultipartUpload = (error: unknown): boolean =>
  error instanceof Error && /\b(?:10024|NoSuchUpload)\b/u.test(error.message);
