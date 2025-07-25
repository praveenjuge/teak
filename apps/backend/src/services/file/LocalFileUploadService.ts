import { existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UploadedFile, UploadOptions } from '@teak/shared-types';
import { fileTypeFromBuffer } from 'file-type';
import imageSize from 'image-size';
import { FileUploadService } from './file-upload-service.js';

export class LocalFileUploadService extends FileUploadService {
  private uploadsDir: string;

  constructor(uploadsDir?: string) {
    super();
    this.uploadsDir = uploadsDir || '/data';
  }

  async uploadFile(file: File, options: UploadOptions): Promise<UploadedFile> {
    // Validate file size
    if (file.size > options.maxSize) {
      throw new Error(
        `File size ${file.size} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
      );
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
      // Special handling for PDF files - check if it's a PDF by extension as fallback
      const isPdfFile = file.name.toLowerCase().endsWith('.pdf');
      const isPdfAccepted = options.allowedTypes.some(type => 
        type.includes('pdf') || type.includes('application/pdf')
      );
      
      if (isPdfFile && isPdfAccepted) {
        console.log(`Allowing PDF file with detected MIME type: ${fileType.mime}`);
        // Continue with PDF processing
      } else {
        console.log(`File type detected: ${fileType.mime}, allowed types:`, options.allowedTypes);
        throw new Error(`File type ${fileType.mime} is not allowed`);
      }
    }

    // Generate paths
    const datePath = this.createDatePath(options.userId);
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

    // Extract image dimensions if it's an image
    let width: number | undefined;
    let height: number | undefined;

    if (fileType.mime.startsWith('image/')) {
      try {
        const dimensions = imageSize(uint8Array);
        width = dimensions.width;
        height = dimensions.height;
      } catch (error) {
        console.warn('Failed to extract image dimensions:', error);
      }
    }

    return {
      filename,
      originalName: file.name,
      path: relativePath,
      size: file.size,
      mimeType: fileType.mime,
      url,
      width,
      height,
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
