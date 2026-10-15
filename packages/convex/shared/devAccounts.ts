export const CLOUD_DEV_ACCOUNT_EMAIL =
  /^dev\+cloud-[0-9a-f]{8}-[a-z0-9-]+@example\.org$/;

export const CLOUD_DEV_ACCOUNT_EMAIL_RANGE = {
  start: "dev+cloud-",
  end: "dev+cloud.",
} as const;
