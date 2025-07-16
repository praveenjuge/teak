import { execFile } from 'child_process';
import ffprobe from 'ffprobe-static';
import { promisify } from 'util';
import { LocalFileUploadService } from '../file/LocalFileUploadService.js';
import type { ProcessedCardData, ProcessingContext } from './CardProcessor.js';
import { CardProcessor } from './CardProcessor.js';

const execFileAsync = promisify(execFile);

interface VideoMetadata {
  duration?: number;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  format?: string;
}

export class VideoCardProcessor extends CardProcessor {
  private fileUploadService: LocalFileUploadService;

  constructor() {
    super();
    this.fileUploadService = new LocalFileUploadService();
  }

  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    if (!context.file) {
      // Handle URL-based video
      const mediaUrl = context.inputData['media_url'];
      if (!mediaUrl) {
        throw new Error(
          'Video card requires either a file upload or media_url'
        );
      }

      return {
        data: {
          media_url: mediaUrl,
        },
        metaInfo: context.inputData['metaInfo'] || {},
      };
    }

    // Handle file upload
    const uploadResult = await this.fileUploadService.uploadFile(context.file, {
      maxSize: 200 * 1024 * 1024, // 200MB
      allowedTypes: [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/avi',
        'video/mov',
        'video/wmv',
        'video/flv',
        'video/mkv',
        'video/m4v',
        'video/3gp',
        'video/quicktime',
      ],
      generateUrl: (path) => `/api/data/${path}`,
    });

    // Extract video metadata
    const metadata = await this.extractVideoMetadata(uploadResult.path);

    return {
      data: {
        media_url: uploadResult.url,
        original_filename: uploadResult.originalName,
      },
      metaInfo: {
        file_size: uploadResult.size,
        mime_type: uploadResult.mimeType,
        duration: metadata.duration,
        bitrate: metadata.bitrate,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        codec: metadata.codec,
        format: metadata.format,
        uploaded_at: new Date().toISOString(),
      },
    };
  }

  private async extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
    try {
      const fullPath = `/data/${filePath}`;
      const { stdout } = await execFileAsync(ffprobe.path, [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        fullPath,
      ]);

      const result = JSON.parse(stdout);
      const videoStream = result.streams?.find(
        (stream: any) => stream.codec_type === 'video'
      );

      if (!videoStream) {
        return {};
      }

      return {
        duration: Number.parseFloat(result.format?.duration) || undefined,
        bitrate: Number.parseInt(result.format?.bit_rate) || undefined,
        width: Number.parseInt(videoStream.width) || undefined,
        height: Number.parseInt(videoStream.height) || undefined,
        fps: this.calculateFps(videoStream.r_frame_rate),
        codec: videoStream.codec_name || undefined,
        format: result.format?.format_name || undefined,
      };
    } catch (error) {
      console.warn('Failed to extract video metadata:', error);
      return {};
    }
  }

  private calculateFps(frameRate?: string): number | undefined {
    if (!frameRate) return;

    try {
      // Handle frame rates like "30/1" or "24000/1001"
      const [numerator, denominator] = frameRate.split('/').map(Number);
      const num = numerator ?? 0;
      return denominator ? Math.round((num / denominator) * 100) / 100 : num;
    } catch {
      return;
    }
  }
}
