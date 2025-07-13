import { useQuery } from '@tanstack/react-query';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Card } from '@/lib/api';
import { apiClient } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { colors } from '../constants/colors';
import { CardItem } from './CardItem';

interface CardsGridProps {
  searchQuery?: string;
  selectedType?: Card['type'];
}

export function CardsGrid({ searchQuery, selectedType }: CardsGridProps) {
  // Check authentication state
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
  } = authClient?.useSession() || { data: null, isPending: false, error: null };

  const { data, error, refetch, isLoading, isRefetching } = useQuery({
    queryKey: ['cards', { searchQuery, selectedType }],
    queryFn: async () => {
      try {
        const result = await apiClient.getCards({
          q: searchQuery?.trim() || undefined,
          type: selectedType,
          sort: 'created_at',
          order: 'desc',
          limit: 100,
        });
        return result;
      } catch (err) {
        throw err;
      }
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

  const renderCard = ({ item, index }: { item: Card; index: number }) => (
    <View
      style={[styles.cardContainer, { marginRight: index % 2 === 0 ? 8 : 0 }]}
    >
      <CardItem card={item} onDelete={refetch} />
    </View>
  );

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

  return (
    <FlatList
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.container}
      data={data?.cards || []}
      keyExtractor={(item) => item.id.toString()}
      ListEmptyComponent={renderEmpty}
      numColumns={2}
      refreshControl={
        <RefreshControl onRefresh={refetch} refreshing={isRefetching} />
      }
      renderItem={renderCard}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
  },
  cardContainer: {
    flex: 1,
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
