import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessedCardData, ProcessingContext } from '@teak/shared-types';
import ffprobe from 'ffprobe-static';
import { LocalFileUploadService } from '../file/LocalFileUploadService.js';
import { CardProcessor } from './card-processor.js';

const execFileAsync = promisify(execFile);

interface AudioMetadata {
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  format?: string;
}

export class AudioCardProcessor extends CardProcessor {
  private fileUploadService: LocalFileUploadService;

  constructor() {
    super();
    this.fileUploadService = new LocalFileUploadService();
  }

  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    if (!context.file) {
      // Handle URL-based audio
      const mediaUrl = context.inputData.media_url;
      if (!mediaUrl) {
        throw new Error(
          'Audio card requires either a file upload or media_url'
        );
      }

      return {
        data: {
          media_url: mediaUrl,
          transcription: context.inputData.transcription || '',
        },
        metaInfo: context.inputData.metaInfo || {},
      };
    }

    // Handle file upload
    const uploadResult = await this.fileUploadService.uploadFile(context.file, {
      maxSize: 200 * 1024 * 1024, // 200MB
      allowedTypes: [
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/ogg',
        'audio/webm',
        'audio/aac',
        'audio/flac',
        'audio/x-m4a',
        'video/webm', // Allow video/webm as it's often used for audio-only recordings
      ],
      generateUrl: (path: string) => `/api/data/${path}`,
      userId: context.userId,
    });

    // Extract audio metadata
    const metadata = await this.extractAudioMetadata(uploadResult.path);

    return {
      data: {
        media_url: uploadResult.url,
        transcription: context.inputData.transcription || '',
        original_filename: uploadResult.originalName,
      },
      metaInfo: {
        file_size: uploadResult.size,
        mime_type: uploadResult.mimeType,
        duration: metadata.duration,
        bitrate: metadata.bitrate,
        sample_rate: metadata.sampleRate,
        channels: metadata.channels,
        format: metadata.format,
        uploaded_at: new Date().toISOString(),
      },
    };
  }

  private async extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
    try {
      const uploadPath = '/data';
      const fullPath = `${uploadPath}/${filePath}`;
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
      const audioStream = result.streams?.find(
        (stream: { codec_type: string }) => stream.codec_type === 'audio'
      );

      if (!audioStream) {
        return {};
      }

      return {
        duration: Number.parseFloat(result.format?.duration) || undefined,
        bitrate: Number.parseInt(result.format?.bit_rate, 10) || undefined,
        sampleRate: Number.parseInt(audioStream.sample_rate, 10) || undefined,
        channels: Number.parseInt(audioStream.channels, 10) || undefined,
        format: audioStream.codec_name || undefined,
      };
    } catch (error) {
      console.warn('Failed to extract audio metadata:', error);
      return {};
    }
  }
}
