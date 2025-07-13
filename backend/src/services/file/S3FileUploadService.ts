import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import imageSize from 'image-size';
import { FileUploadService } from './FileUploadService.js';
import type { UploadedFile, UploadOptions } from './FileUploadService.js';

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3FileUploadService extends FileUploadService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    super();
    this.bucket = config.bucket;
    
    this.s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.accessKeyId && config.secretAccessKey ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      } : undefined,
      forcePathStyle: config.forcePathStyle || false,
    });
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

    // Generate paths (maintain same structure as local storage)
    const datePath = this.createDatePath();
    const filename = this.generateUniqueFilename(file.name);
    const key = `${datePath}/${filename}`;

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: uint8Array,
      ContentType: fileType.mime,
      ContentLength: file.size,
    });

    await this.s3Client.send(uploadCommand);

    // Generate URL
    const url = options.generateUrl(key);

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
      path: key,
      size: file.size,
      mimeType: fileType.mime,
      url,
      width,
      height
    };
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(deleteCommand);
    } catch (error) {
      console.warn(`Failed to delete S3 object ${key}:`, error);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}