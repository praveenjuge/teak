import { useDeleteCard } from '@teak/shared-queries';
import type { CardItemProps } from '@teak/shared-types';
import { Clock, Download, FileText, Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { apiClient } from '@/lib/api';
import { CardDetailsModal } from './CardDetailsModal';

// Helper function to format duration
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const { playAudio, pauseAudio, currentlyPlaying } = useAudioPlayer();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const isPlaying =
    currentlyPlaying !== null && currentlyPlaying === audioRef.current;

  // Delete mutation with optimistic updates
  const deleteMutation = useDeleteCard(apiClient);

  const handleDelete = () => {
    if (deleteMutation.isPending) {
      return;
    }
    deleteMutation.mutate(card.id, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        onDelete?.();
      },
    });
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleAudioEnded = () => {
      if (isPlaying) {
        pauseAudio(audio);
      }
    };

    audio.addEventListener('ended', handleAudioEnded);

    return () => {
      audio.removeEventListener('ended', handleAudioEnded);
    };
  }, [isPlaying, pauseAudio]);

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        pauseAudio(audioRef.current);
      } else {
        playAudio(audioRef.current);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && progressRef.current) {
      const progress =
        (audioRef.current.currentTime / audioRef.current.duration) * 100;
      progressRef.current.style.width = `${progress}%`;
    }
  };

  const handleUrlClick = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open modal if clicking on interactive elements (but audio and URL cards now open modal)
    if (
      e.target instanceof HTMLElement &&
      (e.target.closest('button') ||
        e.target.closest('a') ||
        e.target.tagName === 'BUTTON' ||
        e.target.tagName === 'A')
    ) {
      return;
    }
    setShowDetailsModal(true);
  };

  // Render content based on card type
  const renderCardContent = () => {
    switch (card.type) {
      case 'image': {
        if (!card.data.media_url) {
          return null;
        }

        // Get image dimensions from stored data
        const width = card.data.width;
        const height = card.data.height;

        return (
          <div
            className="overflow-hidden rounded bg-muted"
            style={{
              aspectRatio: width && height ? `${width} / ${height}` : undefined,
            }}
          >
            <img
              alt={card.data.alt_text || 'Image'}
              className="h-full w-full object-cover"
              loading="lazy"
              src={card.data.media_url}
            />
          </div>
        );
      }

      case 'video':
        return (
          <div className="relative aspect-video overflow-hidden rounded bg-muted">
            {card.data.media_url ? (
              // For now, we'll show a gray background as video placeholder
              // In the future, this could be a video thumbnail
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted" />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-black/60 p-3">
                <Play className="size-4 fill-white text-white" />
              </div>
            </div>
            {card.data.duration && (
              <div className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-1 text-white text-xs">
                {formatDuration(card.data.duration)}
              </div>
            )}
          </div>
        );

      case 'audio':
        return (
          <div className="flex w-full items-center justify-between space-x-4 p-4">
            <audio
              onTimeUpdate={handleTimeUpdate}
              ref={audioRef}
              src={card.data.media_url}
            />
            <div className="rounded-full bg-primary p-1.5">
              {isPlaying ? (
                <Pause className="size-3.5 fill-current text-primary-foreground" />
              ) : (
                <Play className="size-3.5 fill-current text-primary-foreground" />
              )}
            </div>
            <div className="h-2 flex-grow rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-border"
                ref={progressRef}
              />
            </div>
            {card.data.duration ? (
              <div className="flex items-center space-x-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span className="text-sm">
                  {formatDuration(card.data.duration)}
                </span>
              </div>
            ) : null}
          </div>
        );

      case 'url':
        if (!card.data.url) {
          return null;
        }
        return (
          <div>
            {card.data.screenshot_url ? (
              <img
                alt={card.data.title || 'Website preview'}
                className="h-30 w-full rounded-t object-cover"
                loading="lazy"
                src={card.data.screenshot_url}
              />
            ) : (
              <div className="h-30 w-full rounded-t bg-muted" />
            )}
            <p className="min-w-0 truncate p-4 font-medium text-primary">
              {card.data.title || card.data.url}
            </p>
          </div>
        );

      case 'pdf':
        return (
          <div className="flex items-center justify-between space-x-2 p-4">
            <div className="rounded-full bg-red-100 p-2">
              <FileText className="size-5 text-red-600" />
            </div>
            <div>
              <h4 className="font-medium">
                {card.data.title ||
                  card.data.original_filename ||
                  'PDF Document'}
              </h4>
              <div className="flex items-center space-x-3 text-muted-foreground text-sm">
                {card.data.page_count && (
                  <span>{card.data.page_count} pages</span>
                )}
                {card.metaInfo?.file_size && (
                  <span>
                    {Math.round((card.metaInfo.file_size / 1024 / 1024) * 100) /
                      100}{' '}
                    MB
                  </span>
                )}
              </div>
            </div>
          </div>
        );

      case 'text':
        if (!card.data.content) {
          return null;
        }
        return <p className="p-4 leading-relaxed">{card.data.content}</p>;

      default:
        return <p className="p-4 leading-relaxed">{card.data.content}</p>;
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card
            className="relative cursor-pointer overflow-hidden p-0"
            onClick={handleCardClick}
          >
            <CardContent className="p-0">{renderCardContent()}</CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={deleteMutation.isPending}
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
        <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Card</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this card? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                onClick={handleDelete}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ContextMenu>

      <CardDetailsModal
        card={card}
        onOpenChange={setShowDetailsModal}
        open={showDetailsModal}
      />
    </>
  );
}
