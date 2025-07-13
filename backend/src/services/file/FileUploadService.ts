export interface UploadedFile {
  filename: string;
  originalName: string;
  path: string;
  size: number;
  mimeType: string;
  url: string;
  width?: number; // Image width in pixels
  height?: number; // Image height in pixels
}

export interface UploadOptions {
  maxSize: number;
  allowedTypes?: string[];
  generateUrl: (path: string) => string;
}

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

  protected createDatePath(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }
}
