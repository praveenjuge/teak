// The WorkOS staging accounts Claude Code cloud sessions sign in with on the
// shared dev deployment (scripts/lib/dev-account.ts names them). These are the
// only accounts dev tooling may delete.
export const CLOUD_DEV_ACCOUNT_EMAIL =
  /^dev\+cloud-[0-9a-f]{8}-[a-z0-9-]+@example\.org$/;

// Every matching address sorts inside [start, end): "." follows "-".
export const CLOUD_DEV_ACCOUNT_EMAIL_RANGE = {
  start: "dev+cloud-",
  end: "dev+cloud.",
} as const;
