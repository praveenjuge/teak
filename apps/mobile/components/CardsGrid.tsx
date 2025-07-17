import { useQuery } from '@tanstack/react-query';
import type { Card, CardsGridProps } from '@teak/shared-types';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiClient } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { colors } from '../constants/colors';
import { CardItem } from './CardItem';

export function CardsGrid({ searchQuery, selectedType }: CardsGridProps) {
  // Check authentication state
  const { isPending: sessionPending } = authClient?.useSession() || {
    data: null,
    isPending: false,
    error: null,
  };

  const { data, error, refetch, isLoading, isRefetching } = useQuery({
    queryKey: ['cards', { searchQuery, selectedType }],
    queryFn: async () => {
      const result = await apiClient.getCards({
        q: searchQuery?.trim() || undefined,
        type: selectedType,
        sort: 'created_at',
        order: 'desc',
        limit: 100,
      });
      return result;
    },
    enabled: !sessionPending, // Don't run query while session is loading
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // Define dynamic styles
  const dynamicStyles = {
    loadingText: {
      color: colors.secondaryLabel,
    },
    errorTitle: {
      color: colors.label,
    },
    errorDescription: {
      color: colors.secondaryLabel,
    },
    emptyTitle: {
      color: colors.label,
    },
    emptyDescription: {
      color: colors.secondaryLabel,
    },
  };

  // Show loading if session is still loading
  if (sessionPending) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  const renderMasonryLayout = () => {
    const cards = data?.cards || [];
    if (cards.length === 0) {
      return null;
    }

    const leftColumn: Card[] = [];
    const rightColumn: Card[] = [];

    // Simple alternating distribution for masonry effect
    cards.forEach((card, index) => {
      if (index % 2 === 0) {
        leftColumn.push(card);
      } else {
        rightColumn.push(card);
      }
    });

    return (
      <View style={styles.masonryContainer}>
        <View style={styles.column}>
          {leftColumn.map((card) => (
            <View key={card.id} style={styles.cardContainer}>
              <CardItem card={card} onDelete={refetch} />
            </View>
          ))}
        </View>
        <View style={styles.column}>
          {rightColumn.map((card) => (
            <View key={card.id} style={styles.cardContainer}>
              <CardItem card={card} onDelete={refetch} />
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyTitle, dynamicStyles.emptyTitle]}>
        {searchQuery ? 'No cards found' : 'No cards yet'}
      </Text>
      <Text style={[styles.emptyDescription, dynamicStyles.emptyDescription]}>
        {searchQuery
          ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ''}`
          : 'Start by adding your first card'}
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={[styles.errorTitle, dynamicStyles.errorTitle]}>
          Failed to load cards
        </Text>
        <Text style={[styles.errorDescription, dynamicStyles.errorDescription]}>
          {error instanceof Error ? error.message : 'Something went wrong'}
        </Text>
      </View>
    );
  }

  if ((data?.cards || []).length === 0) {
    return renderEmpty();
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl onRefresh={refetch} refreshing={isRefetching} />
      }
      showsVerticalScrollIndicator={false}
    >
      {renderMasonryLayout()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 100,
  },
  masonryContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  column: {
    flex: 1,
  },
  cardContainer: {
    marginBottom: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  errorDescription: {
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDescription: {
    textAlign: 'center',
    lineHeight: 20,
  },
});
