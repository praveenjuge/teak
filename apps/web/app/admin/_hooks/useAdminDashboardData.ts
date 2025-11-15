"use client";

import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useRouter, notFound } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@teak/convex";
import {
  MAX_PENDING_COUNT,
  buildStageList,
  formatNumber,
  normalizePipelineSummary,
  type HeadlineCard,
  type MetadataItem,
  type MissingCard,
  type NormalizedPipelineSummary,
  type OverviewResponse,
  type StageListEntry,
} from "../dashboard-model";

type PendingRetries = Record<string, number>;

export type AdminDashboardViewModel = {
  generatedAt: number;
  headlineCards: HeadlineCard[];
  cardsByTypeEntries: Array<[string, number]>;
  metadataItems: MetadataItem[];
  stageList: StageListEntry[];
  pipelineSummary: NormalizedPipelineSummary;
  missingCards: MissingCard[];
  pendingRetries: PendingRetries;
  retryingCardId: string | null;
  handleCardRetry: (cardId: string) => Promise<void>;
};

type AdminDashboardState =
  | { status: "loading" }
  | { status: "ready"; viewModel: AdminDashboardViewModel };

const DEFAULT_METADATA_COUNTS = {
  completed: 0,
  pending: 0,
  failed: 0,
  unset: 0,
};

const INITIAL_TOTALS = {
  totalCards: 0,
  activeCards: 0,
  deletedCards: 0,
  uniqueUsers: 0,
};

const INITIAL_GROWTH = {
  createdLastSevenDays: 0,
  createdLastThirtyDays: 0,
};

export function useAdminDashboardData(): AdminDashboardState {
  const router = useRouter();
  //@ts-ignore
  const user = useQuery(api.auth.getCurrentUser);
  const [isLoaded, setIsLoaded] = useState(false);

  const shouldCheckAccess = Boolean(user);

  useEffect(() => {
    setIsLoaded(true);
  }, []);
  useEffect(() => {
    if (isLoaded && !user) {
      router.replace("/");
    }
  }, [isLoaded, router, user]);

  const access = useQuery(
    api.admin.getAccess,
    shouldCheckAccess ? {} : "skip"
  ) as { allowed: boolean } | undefined;

  const isAdmin = access?.allowed === true;

  useEffect(() => {
    if (isLoaded && access && access.allowed === false) {
      notFound();
    }
  }, [access, isLoaded]);

  const overview = useQuery(
    api.admin.getOverview,
    isAdmin ? {} : "skip"
  ) as OverviewResponse | undefined;

  const pipelineSummary = useMemo(
    () => normalizePipelineSummary(overview?.aiPipeline),
    [overview?.aiPipeline]
  );

  const cardsByTypeEntries = useMemo(
    () =>
      Object.entries(overview?.cardsByType ?? {}).sort(
        (a, b) => (b[1] ?? 0) - (a[1] ?? 0)
      ),
    [overview?.cardsByType]
  );

  const metadataCounts = overview?.metadataStatus
    ? {
      completed: Number(overview.metadataStatus.completed ?? 0),
      pending: Number(overview.metadataStatus.pending ?? 0),
      failed: Number(overview.metadataStatus.failed ?? 0),
      unset: Number(overview.metadataStatus.unset ?? 0),
    }
    : DEFAULT_METADATA_COUNTS;

  const metadataItems: MetadataItem[] = [
    { label: "Completed", value: metadataCounts.completed },
    { label: "Pending", value: metadataCounts.pending },
    { label: "Failed", value: metadataCounts.failed },
    { label: "Not yet processed", value: metadataCounts.unset },
  ];

  const totals = overview?.totals ?? INITIAL_TOTALS;
  const growth = overview?.growth ?? INITIAL_GROWTH;

  const totalCards = totals.totalCards ?? 0;
  const activeCards = totals.activeCards ?? 0;
  const deletedCards = totals.deletedCards ?? 0;
  const uniqueUsers = totals.uniqueUsers ?? 0;
  const newCards7d = growth.createdLastSevenDays ?? 0;
  const newCards30d = growth.createdLastThirtyDays ?? 0;

  const enrichedCount = Math.max(
    totalCards - pipelineSummary.missingAiMetadata,
    0
  );
  const enrichmentCompletionRate =
    totalCards > 0 ? Math.round((enrichedCount / totalCards) * 100) : 100;
  const backlogShare =
    totalCards > 0
      ? Math.round((pipelineSummary.missingAiMetadata / totalCards) * 100)
      : 0;
  const deletedShare =
    totalCards > 0 ? Math.round((deletedCards / totalCards) * 100) : 0;

  const headlineCards: HeadlineCard[] = [
    {
      title: "Total cards",
      value: formatNumber(totalCards),
      description: `${formatNumber(uniqueUsers)} unique users`,
    },
    {
      title: "Active cards",
      value: formatNumber(activeCards),
      description: `${deletedShare}% in trash (${formatNumber(deletedCards)})`,
    },
    {
      title: "New this week",
      value: formatNumber(newCards7d),
      description: `${formatNumber(newCards30d)} added in 30 days`,
    },
    {
      title: "AI-enriched",
      value: formatNumber(enrichedCount),
      description: `${enrichmentCompletionRate}% completed`,
    },
    {
      title: "Pending enrichment",
      value: formatNumber(pipelineSummary.missingAiMetadata),
      description: `${backlogShare}% of all cards`,
    },
    {
      title: "In flight",
      value: formatNumber(pipelineSummary.pendingEnrichment),
      description: `${formatNumber(pipelineSummary.failedCards)} need attention`,
    },
  ];

  const stageList = buildStageList(pipelineSummary.stageSummaries);
  const limitedMissingCards = useMemo(
    () => pipelineSummary.missingCards.slice(0, MAX_PENDING_COUNT),
    [pipelineSummary.missingCards]
  );

  const retryCardEnrichment = useAction(api.admin.retryCardEnrichment);
  type RetryArgs = Parameters<typeof retryCardEnrichment>[0];

  const [retryingCardId, setRetryingCardId] = useState<string | null>(null);
  const [pendingRetries, setPendingRetries] = useState<PendingRetries>({});

  const handleCardRetry = useCallback(
    async (cardId: string) => {
      if (retryingCardId) {
        return;
      }
      setRetryingCardId(cardId);
      setPendingRetries((prev) => ({
        ...prev,
        [cardId]: (prev[cardId] ?? 0) + 1,
      }));
      try {
        const result = await retryCardEnrichment({
          cardId: cardId as RetryArgs["cardId"],
        });
        if (result.success) {
          toast.success("AI enrichment queued", {
            description: `Pipeline restarted for card ${cardId.slice(0, 8)}…`,
          });
        } else {
          toast.error("Unable to enqueue enrichment", {
            description:
              result.reason === "not_found"
                ? "That card no longer exists."
                : "Please try again shortly.",
          });
        }
      } catch (error) {
        toast.error("Failed to trigger AI enrichment", {
          description:
            error instanceof Error ? error.message : "Unknown error occurred.",
        });
      } finally {
        setRetryingCardId(null);
        setTimeout(() => {
          setPendingRetries((prev) => {
            const { [cardId]: _, ...rest } = prev;
            return rest;
          });
        }, 2000);
      }
    },
    [retryCardEnrichment, retryingCardId]
  );

  const isReady = isLoaded && isAdmin && Boolean(overview);

  if (!isReady) {
    return { status: "loading" };
  }

  return {
    status: "ready",
    viewModel: {
      generatedAt: overview!.generatedAt,
      headlineCards,
      cardsByTypeEntries,
      metadataItems,
      stageList,
      pipelineSummary,
      missingCards: limitedMissingCards,
      pendingRetries,
      retryingCardId,
      handleCardRetry,
    },
  };
}
