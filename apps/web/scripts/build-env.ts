/**
 * The commit a build comes from: Workers Builds sets WORKERS_CI_COMMIT_SHA,
 * GitHub Actions GITHUB_SHA, and anything else may pass GIT_SHA.
 */
export const resolveCommitSha = (
  env: Record<string, string | undefined>
): string | undefined =>
  env.WORKERS_CI_COMMIT_SHA?.trim() ||
  env.GITHUB_SHA?.trim() ||
  env.GIT_SHA?.trim() ||
  undefined;
