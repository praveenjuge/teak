import { mkdir, writeFile, unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { FileUploadService } from './FileUploadService.js';
import type { UploadedFile, UploadOptions } from './FileUploadService.js';

export class LocalFileUploadService extends FileUploadService {
  private uploadsDir: string;

  constructor(uploadsDir: string = './uploads') {
    super();
    this.uploadsDir = uploadsDir;
  }

  async uploadFile(file: File, options: UploadOptions): Promise<UploadedFile> {
    // Validate file size
    if (file.size > options.maxSize) {
      throw new Error(`File size ${file.size} bytes exceeds maximum allowed size of ${options.maxSize} bytes`);
    }

    // Read file buffer
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    // Detect file type
    const fileType = await fileTypeFromBuffer(uint8Array);
    if (!fileType) {
      throw new Error('Unable to detect file type');
    }

    // Validate file type if restrictions provided
    if (options.allowedTypes && !options.allowedTypes.includes(fileType.mime)) {
      throw new Error(`File type ${fileType.mime} is not allowed`);
    }

    // Generate paths
    const datePath = this.createDatePath();
    const filename = this.generateUniqueFilename(file.name);
    const relativePath = path.join(datePath, filename);
    const fullPath = path.join(this.uploadsDir, relativePath);
    const dirPath = path.dirname(fullPath);

    // Ensure directory exists
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }

    // Write file
    await writeFile(fullPath, uint8Array);

    // Generate URL
    const url = options.generateUrl(relativePath);

    return {
      filename,
      originalName: file.name,
      path: relativePath,
      size: file.size,
      mimeType: fileType.mime,
      url
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.uploadsDir, filePath);
    try {
      await unlink(fullPath);
    } catch (error) {
      console.warn(`Failed to delete file ${fullPath}:`, error);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.uploadsDir, filePath);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}