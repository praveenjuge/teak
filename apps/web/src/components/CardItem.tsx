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
          <div className="flex h-16 items-center justify-between space-x-0.5 p-4">
            {/* Generate audio wave bars */}
            {Array.from({ length: 55 }).map((_, i) => (
              <div
                className={`rounded bg-muted-foreground transition-all duration-300 ${
                  isPlaying ? 'animate-pulse' : ''
                }`}
                key={i}
                style={{
                  width: '2px',
                  height: `${Math.random() * 60 + 20}%`,
                  animationDelay: `${i * 50}ms`,
                }}
              />
            ))}
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
          <div>
            {card.data.media_url ? (
              <div className="h-32 w-full overflow-hidden rounded-t">
                <embed
                  className="pointer-events-none select-none"
                  height="100%"
                  src={`${card.data.media_url}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
                  type="application/pdf"
                  width="100%"
                />
              </div>
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded-t bg-gradient-to-br from-red-50 to-red-100">
                <div className="rounded-full bg-red-100 p-3">
                  <FileText className="size-8 text-red-600" />
                </div>
              </div>
            )}
            <p className="min-w-0 truncate p-4 font-medium">
              {card.data.title || card.data.original_filename || 'PDF Document'}
            </p>
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
