/**
 * Origins of the Files Worker, which serves Teak's signed file URLs. No
 * imports: repo scripts read this before dependencies are installed.
 */
export const TEAK_FILES_ORIGINS = {
  production: "https://files.teakvault.com",
  development: "https://teak-files-development.praveenjuge.workers.dev",
} as const;
