import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useColorScheme,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { Card } from "@/lib/api";
import { CardItem } from "./CardItem";
import { authClient } from "@/lib/auth-client";

interface CardsGridProps {
  searchQuery?: string;
  selectedType?: Card["type"];
}

export function CardsGrid({ searchQuery, selectedType }: CardsGridProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  // Check authentication state
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
  } = authClient?.useSession() || { data: null, isPending: false, error: null };

  console.log("[CardsGrid] Component rendered with props:", {
    searchQuery,
    selectedType,
  });
  console.log("[CardsGrid] Auth session state:", {
    hasSession: !!session,
    sessionPending,
    sessionError: sessionError?.message || null,
    userId: session?.user?.id || null,
  });

  const { data, error, refetch, isLoading, isRefetching } = useQuery({
    queryKey: ["cards", { searchQuery, selectedType }],
    queryFn: async () => {
      console.log("[CardsGrid] Starting API call with params:", {
        q: searchQuery?.trim() || undefined,
        type: selectedType,
        sort: "created_at",
        order: "desc",
        limit: 100,
      });

      try {
        const result = await apiClient.getCards({
          q: searchQuery?.trim() || undefined,
          type: selectedType,
          sort: "created_at",
          order: "desc",
          limit: 100,
        });
        console.log("[CardsGrid] API call successful:", result);
        return result;
      } catch (err) {
        console.error("[CardsGrid] API call failed:", err);
        console.error("[CardsGrid] Error details:", {
          name: err instanceof Error ? err.name : "Unknown",
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      }
    },
    enabled: !sessionPending, // Don't run query while session is loading
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  console.log("[CardsGrid] Query state:", {
    isLoading,
    isRefetching,
    hasData: !!data,
    hasError: !!error,
    dataLength: data?.cards?.length || 0,
    sessionPending,
    queryEnabled: !sessionPending,
  });

  if (error) {
    console.error("[CardsGrid] Rendering error state:", error);
  }

  // Define dynamic styles
  const dynamicStyles = {
    loadingText: {
      color: isDark ? "#ccc" : "#666",
    },
    errorTitle: {
      color: isDark ? "#fff" : "#333",
    },
    errorDescription: {
      color: isDark ? "#ccc" : "#666",
    },
    emptyTitle: {
      color: isDark ? "#fff" : "#333",
    },
    emptyDescription: {
      color: isDark ? "#ccc" : "#666",
    },
  };

  // Show loading if session is still loading
  if (sessionPending) {
    console.log("[CardsGrid] Session is still loading, showing loading state");
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
        <Text style={[styles.loadingText, dynamicStyles.loadingText]}>
          Checking authentication...
        </Text>
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
        {searchQuery ? "No cards found" : "No cards yet"}
      </Text>
      <Text style={[styles.emptyDescription, dynamicStyles.emptyDescription]}>
        {searchQuery
          ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
          : "Start by adding your first card"}
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={[styles.loadingText, dynamicStyles.loadingText]}>
          Loading cards...
        </Text>
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
          {error instanceof Error ? error.message : "Something went wrong"}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={data?.cards || []}
      renderItem={renderCard}
      keyExtractor={(item) => item.id.toString()}
      numColumns={2}
      contentContainerStyle={styles.container}
      columnWrapperStyle={styles.row}
      ListEmptyComponent={renderEmpty}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
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
    justifyContent: "space-between",
  },
  cardContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDescription: {
    fontSize: 14,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
