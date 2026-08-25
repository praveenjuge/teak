/**
 * Explicit R2 S3 configuration for the retained direct-S3 paths (import
 * source archives and the Markdown document migration). These flows read and
 * write objects with their own S3 client; canonical card byte processing goes
 * through the Files Worker instead.
 */
export const explicitR2Config = () => {
  const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
    process.env;
  if (!(R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)) {
    throw new Error("R2 environment variables are not configured");
  }
  return {
    accessKeyId: R2_ACCESS_KEY_ID,
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
};
