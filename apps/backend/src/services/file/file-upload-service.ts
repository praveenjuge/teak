import type { UploadedFile, UploadOptions } from '@teak/shared-types';

export abstract class FileUploadService {
  abstract uploadFile(
    file: File,
    options: UploadOptions
  ): Promise<UploadedFile>;

  abstract deleteFile(path: string): Promise<void>;

  protected generateUniqueFilename(originalName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop() || '';
    return `${timestamp}-${random}.${extension}`;
  }

  protected createDatePath(userId: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${userId}/${year}/${month}/${day}`;
  }
}
