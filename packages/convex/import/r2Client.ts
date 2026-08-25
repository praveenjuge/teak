"use node";

import { S3Client } from "@aws-sdk/client-s3";
import { explicitR2Config } from "../storage/r2Config";

export function getImportR2Config() {
  const config = explicitR2Config();
  return {
    bucket: config.bucket,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
}

export function createImportS3Client(
  config: ReturnType<typeof getImportR2Config>
) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: config.credentials,
  });
}
