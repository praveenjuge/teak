import type { Card } from '@teak/shared-types';
import {
  Calendar,
  Clock,
  Download,
  FileText,
  Globe,
  Hash,
  Image,
  Music,
  Play,
  Sparkles,
  Tag,
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

export function CardDetailsModal({
  card,
  open,
  onOpenChange,
}: CardDetailsModalProps) {
  if (!card) return null;

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
          </div>
        );

      case 'audio':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-4">
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
                    <p className="text-muted-foreground">
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

            {card.aiTranscript && (
              <div className="space-y-2">
                <h4 className="font-medium">AI Transcript</h4>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {card.aiTranscript}
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
                    <p className="text-muted-foreground">
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
                  <p className="whitespace-pre-wrap leading-relaxed">
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
          </div>
        );

      case 'pdf':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
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
                  <div className="flex items-center space-x-4 text-muted-foreground">
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

            {card.data.extracted_text && (
              <div className="space-y-2">
                <h4 className="font-medium">AI Extracted Content</h4>
                <div className="max-h-96 overflow-y-auto rounded-lg bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {card.data.extracted_text}
                  </p>
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

  // Metadata row component for consistent display
  const MetadataRow = ({ icon: Icon, label, value, className = '' }) => (
    <div className={`flex space-x-2.5 ${className}`}>
      <Icon className="mt-1 size-3.5 stroke-2 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{label}</span>
        {typeof value === 'string' ? (
          <p className="break-words text-muted-foreground">{value}</p>
        ) : (
          <div>{value}</div>
        )}
      </div>
    </div>
  );

  // Render metadata panel
  const renderMetadata = () => (
    <>
      {/* Card Title */}
      <MetadataRow
        icon={Hash}
        label="Title"
        value={
          card.data.title ||
          `${card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card`
        }
      />

      <MetadataRow
        icon={Calendar}
        label="Created"
        value={formatDate(card.createdAt)}
      />

      {card.data.duration && (
        <MetadataRow
          icon={Clock}
          label="Duration"
          value={formatDuration(card.data.duration)}
        />
      )}

      {card.type === 'url' && card.data.url && (
        <MetadataRow
          icon={Globe}
          label="URL"
          value={
            <a
              className="break-all text-primary hover:underline"
              href={card.data.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {card.data.url}
            </a>
          }
        />
      )}

      {card.type === 'url' && card.data.description && (
        <MetadataRow
          icon={Type}
          label="Description"
          value={card.data.description}
        />
      )}

      {/* File Details */}
      {(card.data.original_filename ||
        card.metaInfo?.file_size ||
        (card.data.width && card.data.height)) && (
        <>
          {card.data.original_filename && (
            <MetadataRow
              icon={FileText}
              label="Filename"
              value={card.data.original_filename}
            />
          )}

          {card.metaInfo?.file_size && (
            <MetadataRow
              icon={FileText}
              label="File Size"
              value={formatFileSize(card.metaInfo.file_size)}
            />
          )}

          {card.data.width && card.data.height && (
            <MetadataRow
              icon={Image}
              label="Dimensions"
              value={`${card.data.width} × ${card.data.height}`}
            />
          )}
        </>
      )}

      {/* AI Content */}
      {(card.aiSummary ||
        card.aiTags?.length > 0 ||
        card.metaInfo?.tags?.length > 0) && (
        <>
          {card.aiSummary && (
            <MetadataRow
              icon={Sparkles}
              label="AI Summary"
              value={card.aiSummary}
            />
          )}

          {card.aiTags && card.aiTags.length > 0 && (
            <MetadataRow
              icon={Sparkles}
              label="AI Tags"
              value={
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {card.aiTags.map((tag, index) => (
                    <Badge className="text-xs" key={index} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              }
            />
          )}

          {card.metaInfo?.tags && card.metaInfo.tags.length > 0 && (
            <MetadataRow
              icon={Tag}
              label="Tags"
              value={
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {card.metaInfo.tags.map((tag, index) => (
                    <Badge className="text-xs" key={index} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              }
            />
          )}
        </>
      )}
    </>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex min-h-[calc(100vh-3rem)] flex-1 overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[1000px]">
        {/* Left side - Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderExpandedContent()}
        </div>

        {/* Right side - Metadata with title and close button */}
        <div className="w-80 space-y-6 overflow-y-auto p-4">
          {renderMetadata()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
