"use node";

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { r2ComponentConfig } from "./storage/r2";

const createR2Client = (config: ReturnType<typeof r2ComponentConfig>) =>
  new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    region: "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

export const headUploadedObject = internalAction({
  args: { key: v.string() },
  returns: v.object({
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  }),
  handler: async (_ctx, { key }) => {
    const config = r2ComponentConfig();
    const response = await createR2Client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key })
    );

    return {
      contentType: response.ContentType,
      size: response.ContentLength,
    };
  },
});
