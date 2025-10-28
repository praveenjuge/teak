"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@teak/convex";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Spinner } from "@/components/ui/spinner";

type StageSummary = {
  pending: number;
  inProgress: number;
  failed: number;
};

type OverviewResponse = {
  generatedAt: number;
  totals: {
    totalCards: number;
    activeCards: number;
    deletedCards: number;
    uniqueUsers: number;
  };
  growth: {
    createdLastSevenDays: number;
    createdLastThirtyDays: number;
  };
  cardsByType: Record<string, number>;
  metadataStatus: Record<string, number>;
  aiPipeline: RawPipelineSummary;
};

type RawPipelineSummary = {
  missingAiMetadata?: number;
  pendingEnrichment?: number;
  failedCards?: number;
  stageSummaries?: Record<string, StageSummary>;
  missingCards?: unknown;
};

type NormalizedPipelineSummary = {
  missingAiMetadata: number;
  pendingEnrichment: number;
  failedCards: number;
  stageSummaries: Record<string, StageSummary>;
  missingCards: MissingCard[];
};

const stageLabelMap: Record<string, string> = {
  classify: "Classification",
  categorize: "Categorization",
  metadata: "Metadata",
  renderables: "Renderables",
};

type PipelineStageStatus = {
  status?: "pending" | "in_progress" | "completed" | "failed";
};

type PipelineProcessingStatus = Record<string, PipelineStageStatus | undefined>;

type MissingCard = {
  cardId: string;
  type: string;
  createdAt: number;
  metadataStatus?: "pending" | "completed" | "failed";
  processingStatus?: PipelineProcessingStatus;
  reasons: string[];
};

const formatNumber = (value: number) =>
  Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const STAGE_ORDER = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
] as const;

const MAX_PENDING_COUNT = 50;

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const shouldCheckAccess = isLoaded && !!user?.id;

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
      router.replace("/");
    }
  }, [access, isLoaded, router]);

  const overview = useQuery(api.admin.getOverview, isAdmin ? {} : "skip") as
    | OverviewResponse
    | undefined;

  const retryCardEnrichment = useAction(api.admin.retryCardEnrichment);
  type RetryArgs = Parameters<typeof retryCardEnrichment>[0];
  const [retryingCardId, setRetryingCardId] = useState<string | null>(null);

  const pipelineSummary = useMemo<NormalizedPipelineSummary>(() => {
    const summary = (overview?.aiPipeline ?? {}) as RawPipelineSummary;
    const missingCards = Array.isArray(summary.missingCards)
      ? (summary.missingCards as Array<Record<string, unknown>>)
          .map((card): MissingCard | null => {
            const rawId = card.cardId;
            const id =
              typeof rawId === "string"
                ? rawId
                : rawId != null
                  ? String(rawId)
                  : "";
            if (!id) {
              return null;
            }
            return {
              cardId: id,
              type: typeof card.type === "string" ? card.type : "unknown",
              createdAt: Number(card.createdAt ?? 0),
              metadataStatus:
                (card.metadataStatus as MissingCard["metadataStatus"]) ??
                undefined,
              processingStatus:
                card.processingStatus as PipelineProcessingStatus,
              reasons: Array.isArray(card.reasons)
                ? (card.reasons as unknown[])
                    .map((reason) =>
                      typeof reason === "string" ? reason : String(reason)
                    )
                    .filter((reason) => reason.trim().length > 0)
                : [],
            };
          })
          .filter((card): card is MissingCard => card !== null)
      : [];

    return {
      missingAiMetadata: Number(summary.missingAiMetadata ?? 0),
      pendingEnrichment: Number(summary.pendingEnrichment ?? 0),
      failedCards: Number(summary.failedCards ?? 0),
      stageSummaries: (summary.stageSummaries ?? {}) as Record<
        string,
        StageSummary
      >,
      missingCards: missingCards.map((card) => ({
        ...card,
        reasons: card.reasons.length > 0 ? card.reasons : ["Unknown reason"],
      })),
    } satisfies NormalizedPipelineSummary;
  }, [overview?.aiPipeline]);

  const cardsByTypeEntries = useMemo(
    () =>
      Object.entries(overview?.cardsByType ?? {}).sort(
        (a, b) => (b[1] ?? 0) - (a[1] ?? 0)
      ),
    [overview?.cardsByType]
  );

  const metadataCounts = useMemo(() => {
    const counts = overview?.metadataStatus ?? {};
    return {
      completed: Number(counts.completed ?? 0),
      pending: Number(counts.pending ?? 0),
      failed: Number(counts.failed ?? 0),
      unset: Number(counts.unset ?? 0),
    };
  }, [overview?.metadataStatus]);

  const [pendingRetries, setPendingRetries] = useState<Record<string, number>>(
    {}
  );

  const formatProcessingSummary = (
    processingStatus?: PipelineProcessingStatus
  ) => {
    if (!processingStatus) {
      return "Not started";
    }

    const parts = STAGE_ORDER.map((key) => {
      const status = processingStatus[key]?.status;
      if (!status) {
        return null;
      }
      return `${stageLabelMap[key] ?? key}: ${status.replace(/_/g, " ")}`;
    }).filter(Boolean);

    return parts.length > 0 ? parts.join(" • ") : "Queued";
  };

  const handleCardRetry = async (cardId: string) => {
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
  };

  const renderLoading = () => (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  );

  if (!isLoaded || (shouldCheckAccess && access === undefined)) {
    return renderLoading();
  }

  if (!isAdmin) {
    return renderLoading();
  }

  if (!overview) {
    return renderLoading();
  }

  const { totals, growth, generatedAt } = overview;

  const {
    missingAiMetadata,
    pendingEnrichment,
    failedCards,
    stageSummaries,
    missingCards,
  } = pipelineSummary;

  const totalCards = totals.totalCards ?? 0;
  const activeCards = totals.activeCards ?? 0;
  const deletedCards = totals.deletedCards ?? 0;
  const uniqueUsers = totals.uniqueUsers ?? 0;
  const newCards7d = growth.createdLastSevenDays ?? 0;
  const newCards30d = growth.createdLastThirtyDays ?? 0;

  const enrichedCount = Math.max(totalCards - missingAiMetadata, 0);
  const enrichmentCompletionRate =
    totalCards > 0 ? Math.round((enrichedCount / totalCards) * 100) : 100;
  const backlogShare =
    totalCards > 0 ? Math.round((missingAiMetadata / totalCards) * 100) : 0;
  const deletedShare =
    totalCards > 0 ? Math.round((deletedCards / totalCards) * 100) : 0;

  const headlineCards: Array<{
    title: string;
    value: string;
    description: string;
  }> = [
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
      value: formatNumber(missingAiMetadata),
      description: `${backlogShare}% of all cards`,
    },
    {
      title: "In flight",
      value: formatNumber(pendingEnrichment),
      description: `${formatNumber(failedCards)} need attention`,
    },
  ];

  const metadataItems = [
    { label: "Completed", value: metadataCounts.completed },
    { label: "Pending", value: metadataCounts.pending },
    { label: "Failed", value: metadataCounts.failed },
    { label: "Not yet processed", value: metadataCounts.unset },
  ];

  const orderedStages = STAGE_ORDER.map((key) => ({
    key,
    label: stageLabelMap[key] ?? key,
    summary: stageSummaries[key] ?? { pending: 0, inProgress: 0, failed: 0 },
  }));
  const extraStages = Object.entries(stageSummaries)
    .filter(
      ([key]) => !STAGE_ORDER.includes(key as (typeof STAGE_ORDER)[number])
    )
    .map(([key, summary]) => ({
      key,
      label: stageLabelMap[key] ?? key,
      summary: summary ?? { pending: 0, inProgress: 0, failed: 0 },
    }));
  const stageList = [...orderedStages, ...extraStages];

  return (
    <div className="container mx-auto max-w-5xl space-y-8 py-8 px-4 md:px-6">
      <div className="space-y-2">
        <Link href="/" className="font-medium text-primary">
          &larr; Back
        </Link>
        <Separator className="my-4" />
        <h1 className="text-lg font-semibold text-foreground">
          Admin Control Center
        </h1>
        <p className="text-sm text-muted-foreground">
          High-level health metrics about Teak. All data is aggregated—no
          personal user information is surfaced here.
        </p>
        <p className="text-xs text-muted-foreground">
          Updated{" "}
          {new Date(generatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          .
        </p>
      </div>

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {headlineCards.map((stat) => (
            <Card key={stat.title} className="h-full">
              <CardHeader>
                <CardDescription>{stat.title}</CardDescription>
                <CardTitle className="text-2xl">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {stat.description}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Card Types</CardTitle>
              <CardDescription>
                Distribution of cards by their primary format.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {cardsByTypeEntries.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No cards available yet.
                </p>
              )}
              {cardsByTypeEntries.map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">
                      {type}
                    </Badge>
                  </div>
                  <span className="text-sm font-medium">
                    {formatNumber(count)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata Status</CardTitle>
              <CardDescription>
                AI extraction pipeline outcomes for active cards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {metadataItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium">
                    {formatNumber(item.value)}
                  </span>
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Total tracked</span>
                <span className="font-medium">
                  {formatNumber(
                    metadataItems.reduce((sum, item) => sum + item.value, 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">AI Enrichment Health</CardTitle>
          <CardDescription>
            Track enrichment backlog and spot stuck pipeline stages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Missing metadata</p>
              <p className="text-xl font-semibold">
                {formatNumber(missingAiMetadata)}
              </p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">In progress</p>
              <p className="text-xl font-semibold">
                {formatNumber(pendingEnrichment)}
              </p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Needs attention</p>
              <p className="text-xl font-semibold">
                {formatNumber(failedCards)}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pipeline stage breakdown
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {stageList.map(({ key, label, summary }) => (
                <div
                  key={key}
                  className="rounded-md border border-border/60 px-3 py-2"
                >
                  <p className="text-sm font-medium">{label}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Pending</p>
                      <p className="font-semibold">
                        {formatNumber(summary.pending)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">In progress</p>
                      <p className="font-semibold">
                        {formatNumber(summary.inProgress)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Failed</p>
                      <p className="font-semibold">
                        {formatNumber(summary.failed)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">
            Cards Pending AI Enrichment
          </CardTitle>
          <CardDescription>
            Showing up to {MAX_PENDING_COUNT} cards awaiting enrichment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {missingCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All cards are enriched. Great job!
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Card</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Metadata</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Issues
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Pipeline Status
                    </TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingCards.map((card) => (
                    <TableRow key={card.cardId}>
                      <TableCell className="font-mono text-xs">
                        {card.cardId.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {card.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(card.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell className="capitalize">
                        {card.metadataStatus ?? "unset"}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell align-top text-muted-foreground w-60">
                        <ul className="space-y-1">
                          {card.reasons.map((reason, index) => (
                            <li key={`${card.cardId}-reason-${index}`}>
                              • {reason}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell text-muted-foreground w-48 align-middle">
                        {pendingRetries[card.cardId]
                          ? "Restart queued…"
                          : formatProcessingSummary(card.processingStatus)}
                      </TableCell>
                      <TableCell className="text-right">
                        {pendingRetries[card.cardId] ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Refreshing
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCardRetry(card.cardId)}
                            disabled={retryingCardId === card.cardId}
                          >
                            {retryingCardId === card.cardId ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="size-3 animate-spin" />
                                Retrying…
                              </span>
                            ) : (
                              "Retry"
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Recent cards without AI metadata are listed above. Use the retry
                action to requeue processing without exposing user content.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
