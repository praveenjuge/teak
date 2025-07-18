import type { Card } from '@teak/shared-types';
import {
  Calendar,
  Clock,
  Download,
  FileText,
  Globe,
  Image,
  Music,
  Play,
  Type,
  Video,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface CardDetailsModalProps {
  card: Card | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i];
};

// Helper function to format duration
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// Helper function to format date
const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Get icon for card type
const getCardTypeIcon = (type: Card['type']) => {
  switch (type) {
    case 'text':
      return Type;
    case 'image':
      return Image;
    case 'audio':
      return Music;
    case 'video':
      return Video;
    case 'url':
      return Globe;
    case 'pdf':
      return FileText;
    default:
      return FileText;
  }
};

export function CardDetailsModal({
  card,
  open,
  onOpenChange,
}: CardDetailsModalProps) {
  if (!card) return null;

  const CardTypeIcon = getCardTypeIcon(card.type);

  // Render expanded content based on card type
  const renderExpandedContent = () => {
    switch (card.type) {
      case 'text':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-6">
              <p className="whitespace-pre-wrap text-foreground leading-relaxed">
                {card.data.content}
              </p>
            </div>
          </div>
        );

      case 'image':
        return (
          <div className="space-y-4">
            {card.data.media_url ? (
              <div className="overflow-hidden rounded-lg">
                <img
                  alt={card.data.alt_text || 'Image'}
                  className="h-auto w-full object-contain"
                  src={card.data.media_url}
                />
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-lg bg-muted">
                <Image className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
            {card.data.description && (
              <p className="text-muted-foreground text-sm">
                {card.data.description}
              </p>
            )}
          </div>
        );

      case 'audio':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-6">
              <div className="mb-4 flex items-center space-x-3">
                <div className="rounded-full bg-primary p-3">
                  <Music className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">
                    {card.data.title ||
                      card.data.original_filename ||
                      'Audio File'}
                  </h3>
                  {card.data.duration && (
                    <p className="text-muted-foreground text-sm">
                      Duration: {formatDuration(card.data.duration)}
                    </p>
                  )}
                </div>
              </div>

              {card.data.media_url && (
                <audio className="w-full" controls>
                  <source src={card.data.media_url} />
                  Your browser does not support the audio element.
                </audio>
              )}
            </div>

            {card.data.transcription && (
              <div className="space-y-2">
                <h4 className="font-medium">Transcription</h4>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {card.data.transcription}
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      case 'video':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-6">
              <div className="mb-4 flex items-center space-x-3">
                <div className="rounded-full bg-primary p-3">
                  <Video className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">
                    {card.data.title ||
                      card.data.original_filename ||
                      'Video File'}
                  </h3>
                  {card.data.duration && (
                    <p className="text-muted-foreground text-sm">
                      Duration: {formatDuration(card.data.duration)}
                    </p>
                  )}
                </div>
              </div>

              {card.data.media_url ? (
                <video className="w-full rounded-lg" controls>
                  <source src={card.data.media_url} />
                  Your browser does not support the video element.
                </video>
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg bg-muted">
                  <Play className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {card.data.transcription && (
              <div className="space-y-2">
                <h4 className="font-medium">Transcription</h4>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {card.data.transcription}
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      case 'url':
        return (
          <div className="space-y-4">
            {card.data.screenshot_url && (
              <div className="overflow-hidden rounded-lg">
                <img
                  alt={card.data.title || 'Website preview'}
                  className="h-auto w-full object-contain"
                  src={card.data.screenshot_url}
                  style={{ maxHeight: '60vh' }}
                />
              </div>
            )}

            <div className="rounded-lg bg-muted/50 p-6">
              <div className="mb-4 flex items-center space-x-3">
                <div className="rounded-full bg-primary p-3">
                  <Globe className="h-6 w-6 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">
                    {card.data.title || 'Website'}
                  </h3>
                  <a
                    className="block truncate text-primary text-sm hover:underline"
                    href={card.data.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {card.data.url}
                  </a>
                </div>
              </div>

              {card.data.description && (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {card.data.description}
                </p>
              )}
            </div>
          </div>
        );

      case 'pdf':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="rounded-full bg-red-100 p-3">
                    <FileText className="h-6 w-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">
                      {card.data.title ||
                        card.data.original_filename ||
                        'PDF Document'}
                    </h3>
                    <div className="flex items-center space-x-4 text-muted-foreground text-sm">
                      {card.data.page_count && (
                        <span>{card.data.page_count} pages</span>
                      )}
                      {card.metaInfo?.file_size && (
                        <span>{formatFileSize(card.metaInfo.file_size)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {card.data.media_url && (
                  <Button
                    onClick={() => window.open(card.data.media_url, '_blank')}
                    size="sm"
                    variant="outline"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                )}
              </div>
            </div>

            {card.data.extracted_text && (
              <div className="space-y-2">
                <h4 className="font-medium">Extracted Text</h4>
                <div className="max-h-96 overflow-y-auto rounded-lg bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {card.data.extracted_text}
                  </p>
                </div>
              </div>
            )}

            {card.data.keywords && card.data.keywords.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Keywords</h4>
                <div className="flex flex-wrap gap-2">
                  {card.data.keywords.map((keyword, index) => (
                    <Badge key={index} variant="secondary">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="rounded-lg bg-muted/50 p-6">
            <p className="text-muted-foreground">Content not available</p>
          </div>
        );
    }
  };

  // Render metadata panel
  const renderMetadata = () => (
    <div className="space-y-6">
      <h2 className="font-semibold">
        {card.data.title ||
          `${card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card`}
      </h2>

      <h3 className="mb-3 font-medium">Details</h3>
      <div className="space-y-3">
        <div className="flex items-center space-x-3">
          <CardTypeIcon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm capitalize">{card.type}</span>
        </div>

        <div className="flex items-center space-x-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{formatDate(card.createdAt)}</span>
        </div>

        {card.data.duration && (
          <div className="flex items-center space-x-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {formatDuration(card.data.duration)}
            </span>
          </div>
        )}

        {card.data.original_filename && (
          <div>
            <span className="font-medium text-sm">Filename:</span>
            <p className="text-muted-foreground text-sm">
              {card.data.original_filename}
            </p>
          </div>
        )}

        {card.metaInfo?.file_size && (
          <div>
            <span className="font-medium text-sm">File Size:</span>
            <p className="text-muted-foreground text-sm">
              {formatFileSize(card.metaInfo.file_size)}
            </p>
          </div>
        )}

        {card.data.width && card.data.height && (
          <div>
            <span className="font-medium text-sm">Dimensions:</span>
            <p className="text-muted-foreground text-sm">
              {card.data.width} × {card.data.height}
            </p>
          </div>
        )}
      </div>

      {card.metaInfo?.tags && card.metaInfo.tags.length > 0 && (
        <div>
          <h4 className="mb-2 font-medium">Tags</h4>
          <div className="flex flex-wrap gap-2">
            {card.metaInfo.tags.map((tag, index) => (
              <Badge key={index} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex min-h-[calc(100vh-3rem)] flex-1 overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[1000px]">
        {/* Left side - Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderExpandedContent()}
        </div>

        {/* Right side - Metadata with title and close button */}
        <div className="w-80 overflow-y-auto p-4">{renderMetadata()}</div>
      </DialogContent>
    </Dialog>
  );
}
