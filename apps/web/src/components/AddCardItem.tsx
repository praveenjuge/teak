import { useCreateCard, useCreateCardWithFile } from '@teak/shared-queries';
import type { Card as CardType } from '@teak/shared-types';
import { FileUp, Loader2, Mic, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { apiClient } from '@/lib/api';

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectCardType(content: string): {
  type: CardType['type'];
  data: Record<string, any>;
} {
  const trimmedContent = content.trim();

  if (isUrl(trimmedContent)) {
    try {
      const url = new URL(trimmedContent);
      return {
        type: 'url',
        data: {
          url: trimmedContent,
          title: url.hostname,
          description: `Saved from ${url.hostname}`,
        },
      };
    } catch {
      // Fallback if URL parsing fails
      return {
        type: 'url',
        data: {
          url: trimmedContent,
          title: trimmedContent,
        },
      };
    }
  }

  return {
    type: 'text',
    data: {
      content: trimmedContent,
      title:
        trimmedContent.slice(0, 50) + (trimmedContent.length > 50 ? '...' : ''),
    },
  };
}

export function AddCardItem() {
  const [content, setContent] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createCardMutation = useCreateCard(apiClient);
  const createFileCardMutation = useCreateCardWithFile(
    apiClient,
    setUploadProgress
  );

  // Override the hook's onError and onSuccess to handle progress reset
  const mutateWithProgressReset = (data: any) => {
    createFileCardMutation.mutate(data, {
      onError: (err) => {
        setUploadProgress(null);
      },
      onSuccess: () => {
        setUploadProgress(null);
      },
      onSettled: () => {
        setUploadProgress(null);
      },
    });
  };

  // Recording functionality
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use audio/webm first, fallback to default if not supported
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Use browser default
        }
      }

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log('Recording stopped, chunks:', chunks.length);
        // Ensure we create an audio blob, not video
        const audioMimeType = mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: audioMimeType });
        console.log('Blob created, size:', blob.size, 'type:', blob.type);

        // Create file with audio extension and type
        const fileExtension = audioMimeType.includes('webm') ? 'webm' : 'wav';
        const file = new File(
          [blob],
          `recording-${Date.now()}.${fileExtension}`,
          {
            type: audioMimeType,
          }
        );
        console.log('File created:', file.name, file.size, file.type);

        // Upload the recorded audio
        console.log('Starting upload mutation...');
        mutateWithProgressReset({
          file,
          cardData: {
            type: 'audio',
            metaInfo: {
              source: 'Voice Recording',
              recordingDuration,
              tags: ['voice-recording'],
            },
          },
        });

        // Cleanup
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setRecordingDuration(0);
        setMediaRecorder(null);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);

      // Start duration counter
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (recorder.state === 'recording') {
          setRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
        } else {
          clearInterval(interval);
        }
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  };

  const handleAudioRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Format recording duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file type
    const supportedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/flac',
    ];

    if (!supportedTypes.includes(file.type)) {
      alert(
        'Unsupported file type. Please select an image, video, or audio file.'
      );
      return;
    }

    // Reset file input
    event.target.value = '';

    mutateWithProgressReset({
      file,
      cardData: {
        metaInfo: {
          source: 'File Upload',
          tags: [],
        },
      },
    });
  };

  const handleSave = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const { type, data } = detectCardType(trimmedContent);

    createCardMutation.mutate(
      {
        type,
        data,
        metaInfo: {
          source: 'Manual Entry',
          tags: [],
        },
      },
      {
        onSuccess: () => {
          setContent('');
          textareaRef.current?.focus();
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  if (isRecording) {
    return (
      <Card className="flex min-h-50 flex-col items-center justify-center gap-4 p-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium text-red-700 text-sm">
                Recording...
              </span>
            </div>
            <span className="font-mono text-red-600 text-sm">
              {formatDuration(recordingDuration)}
            </span>
          </div>
        </div>
        <Button
          className="mt-4"
          onClick={stopRecording}
          size="icon"
          title="Stop recording"
          type="button"
          variant="destructive"
        >
          <Square className="h-4 w-4" />
        </Button>
      </Card>
    );
  }

  if (uploadProgress !== null) {
    // Only show uploading status while file is uploading
    return (
      <Card className="flex min-h-50 flex-col items-center justify-center gap-4 p-4">
        <CardContent className="w-full p-0">
          <div className="mt-2 w-full">
            <div className="mb-1 flex justify-between text-muted-foreground text-sm">
              <span>Uploading...</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-h-50 justify-between gap-0 p-0 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
      <textarea
        className="h-full min-h-[80px] w-full flex-1 resize-none p-4 outline-0"
        disabled={createCardMutation.isPending}
        name="content"
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter your bookmark, URL, or note... (⌘+Enter to save)"
        ref={textareaRef}
        value={content}
      />
      <CardFooter className="flex justify-between px-4 pb-4">
        <div className="flex gap-2">
          <input
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handleFileUpload}
            ref={fileInputRef}
            type="file"
          />
          <Button
            disabled={createFileCardMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            title="Add file or image"
            type="button"
            variant="outline"
          >
            {createFileCardMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
          </Button>
          <Button
            disabled={
              createFileCardMutation.isPending || uploadProgress !== null
            }
            onClick={handleAudioRecording}
            size="icon"
            title="Record audio"
            type="button"
            variant="outline"
          >
            <Mic className="h-4 w-4" />
          </Button>
        </div>
        <Button
          disabled={!content.trim() || createCardMutation.isPending}
          onClick={handleSave}
          size="sm"
        >
          {createCardMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <span>Save</span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
