import { z } from 'zod';

const S3ConfigSchema = z.object({
  AWS_S3_BUCKET: z.string().min(1, 'S3 bucket name is required'),
  AWS_S3_REGION: z.string().min(1, 'S3 region is required'),
  AWS_S3_ENDPOINT: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_FORCE_PATH_STYLE: z.string().transform(val => val === 'true').optional(),
});

export type S3Config = z.infer<typeof S3ConfigSchema>;

export function getStorageConfig(): { type: 'local' | 's3'; config?: S3Config } {
  const s3Bucket = process.env['AWS_S3_BUCKET'];
  const s3Region = process.env['AWS_S3_REGION'];

  // If S3 bucket and region are provided, try to use S3
  if (s3Bucket && s3Region) {
    try {
      const config = S3ConfigSchema.parse({
        AWS_S3_BUCKET: s3Bucket,
        AWS_S3_REGION: s3Region,
        AWS_S3_ENDPOINT: process.env['AWS_S3_ENDPOINT'],
        AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'],
        AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'],
        AWS_S3_FORCE_PATH_STYLE: process.env['AWS_S3_FORCE_PATH_STYLE'],
      });

      // Check if credentials are provided (optional for IAM roles)
      const hasCredentials = config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY;
      const hasEndpoint = config.AWS_S3_ENDPOINT;

      if (!hasCredentials && !hasEndpoint) {
        console.warn('S3 configuration incomplete: Using AWS credentials chain or IAM roles');
      }

      console.log(`Using S3 storage: bucket=${config.AWS_S3_BUCKET}, region=${config.AWS_S3_REGION}`);
      return { type: 's3', config };
    } catch (error) {
      console.warn('Invalid S3 configuration, falling back to local storage:', error);
      return { type: 'local' };
    }
  }

  console.log('Using local file storage');
  return { type: 'local' };
}