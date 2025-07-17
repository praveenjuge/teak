import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, ExternalLink, Pause, Play, Trash2 } from 'lucide-react';
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
import type { Card as CardType, CardItemProps } from '@teak/shared-types';
import { apiClient } from '@/lib/api';

// Helper function to format duration
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const { playAudio, pauseAudio, currentlyPlaying } = useAudioPlayer();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const isPlaying =
    currentlyPlaying !== null && currentlyPlaying === audioRef.current;

  // Delete mutation with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: (cardId: number) => apiClient.deleteCard(cardId),
    onMutate: async (cardId) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['cards'] });

      // Snapshot the previous cards data
      const previousQueries = queryClient.getQueriesData({
        queryKey: ['cards'],
      });

      // Optimistically remove the card from all cards queries
      queryClient.setQueriesData({ queryKey: ['cards'] }, (oldData: any) => {
        if (!(oldData && oldData.cards)) return oldData;

        return {
          ...oldData,
          cards: oldData.cards.filter((c: CardType) => c.id !== cardId),
          total: oldData.total - 1,
        };
      });

      // Return a context object with the snapshotted value
      return { previousQueries };
    },
    onError: (err, _, context) => {
      // If the mutation fails, restore all previous queries
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('Failed to delete card:', err);
    },
    onSuccess: () => {
      // Close the dialog and call the onDelete callback
      setShowDeleteDialog(false);
      onDelete?.();
    },
    onSettled: () => {
      // Invalidate and refetch cards to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.mutate(card.id);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioEnded = () => {
      if (isPlaying) {
        pauseAudio(audio);
      }
    };

    audio.addEventListener('ended', handleAudioEnded);

    return () => {
      audio.removeEventListener('ended', handleAudioEnded);
    };
  }, [audioRef, isPlaying, pauseAudio]);

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

  // Render content based on card type
  const renderCardContent = () => {
    switch (card.type) {
      case 'image': {
        if (!card.data.media_url) return null;

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
          <button
            className="flex w-full items-center justify-between space-x-4 p-4"
            onClick={handlePlayPause}
          >
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
          </button>
        );

      case 'url':
        if (!card.data.url) return null;
        return (
          <div
            className="flex cursor-pointer items-center space-x-2 truncate p-4 text-primary transition-colors"
            onClick={() => handleUrlClick(card.data.url)}
          >
            <ExternalLink className="size-4" />
            <span className="max-w-xs truncate font-medium">
              {card.data.title || card.data.url}
            </span>
          </div>
        );

      case 'text':
        if (!card.data.content) return null;
        return <p className="p-4 leading-relaxed">{card.data.content}</p>;

      default:
        return <p className="p-4 leading-relaxed">{card.data.content}</p>;
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Card className="relative overflow-hidden p-0">
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
  );
}
