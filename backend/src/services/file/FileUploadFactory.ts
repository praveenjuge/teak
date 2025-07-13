import { FileUploadService } from './FileUploadService.js';
import { LocalFileUploadService } from './LocalFileUploadService.js';
import { S3FileUploadService } from './S3FileUploadService.js';
import { getStorageConfig } from '../../config/storage.js';

export function createFileUploadService(): FileUploadService {
  const storageConfig = getStorageConfig();

  if (storageConfig.type === 's3' && storageConfig.config) {
    return new S3FileUploadService({
      bucket: storageConfig.config.AWS_S3_BUCKET,
      region: storageConfig.config.AWS_S3_REGION,
      endpoint: storageConfig.config.AWS_S3_ENDPOINT,
      accessKeyId: storageConfig.config.AWS_ACCESS_KEY_ID,
      secretAccessKey: storageConfig.config.AWS_SECRET_ACCESS_KEY,
      forcePathStyle: storageConfig.config.AWS_S3_FORCE_PATH_STYLE,
    });
  }

  return new LocalFileUploadService();
}