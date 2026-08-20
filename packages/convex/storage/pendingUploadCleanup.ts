"use node";

import {
  type _Object,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { PENDING_UPLOAD_CARD_ID, r2ComponentConfig } from "./r2";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const PENDING_UPLOAD_SEGMENT = `/cards/${PENDING_UPLOAD_CARD_ID}/`;

export const stalePendingUploadKeys = (
  objects: _Object[],
  now = Date.now()
): string[] =>
  objects.flatMap((object) => {
    if (
      !(object.Key?.includes(PENDING_UPLOAD_SEGMENT) && object.LastModified) ||
      object.LastModified.getTime() > now - STALE_AFTER_MS
    ) {
      return [];
    }
    return [object.Key];
  });

const createClient = () => {
  const config = r2ComponentConfig();
  return {
    bucket: config.bucket,
    client: new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
  };
};

export const sweepStalePendingUploadsHandler = async (): Promise<null> => {
  const { bucket, client } = createClient();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        Prefix: "users/",
      })
    );
    const keys = stalePendingUploadKeys(page.Contents ?? []);
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  return null;
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: sweepStalePendingUploadsHandler,
});
