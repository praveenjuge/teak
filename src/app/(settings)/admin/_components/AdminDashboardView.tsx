"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MAX_PENDING_COUNT,
  formatNumber,
  formatProcessingSummary,
  type HeadlineCard,
  type MetadataItem,
  type MissingCard,
  type NormalizedPipelineSummary,
  type StageListEntry,
} from "../dashboard-model";
import type { AdminDashboardViewModel } from "../_hooks/useAdminDashboardData";

export function AdminDashboardView({
  headlineCards,
  cardsByTypeEntries,
  metadataItems,
  stageList,
  pipelineSummary,
  missingCards,
  pendingRetries,
  retryingCardId,
  handleCardRetry,
}: AdminDashboardViewModel) {
  return (
    <>
      <AdminIntro />

      <HeadlineStatsGrid cards={headlineCards} />

      <CardTypesCard entries={cardsByTypeEntries} />
      <MetadataStatusCard items={metadataItems} />

      <PipelineHealthCard stageList={stageList} summary={pipelineSummary} />

      <MissingCardsCard
        missingCards={missingCards}
        pendingRetries={pendingRetries}
        retryingCardId={retryingCardId}
        handleCardRetry={handleCardRetry}
      />
    </>
  );
}

const AdminIntro = () => (
  <div className="space-y-2">
    <h1 className="text-lg font-semibold text-foreground">
      Admin Control Center
    </h1>
    <p className="text-sm text-muted-foreground">
      High-level health metrics about Teak. All data is aggregated—no personal
      user information is surfaced here.
    </p>
  </div>
);

const HeadlineStatsGrid = ({ cards }: { cards: HeadlineCard[] }) => (
  <div className="grid gap-4 md:grid-cols-2">
    {cards.map((stat) => (
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
);

const CardTypesCard = ({ entries }: { entries: Array<[string, number]> }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">Card Types</CardTitle>
      <CardDescription>
        Distribution of cards by their primary format.
      </CardDescription>
    </CardHeader>
    <CardContent className="gap-2 flex flex-wrap">
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No cards available yet.</p>
      )}
      {entries.map(([type, count]) => (
        <div
          key={type}
          className="flex items-center justify-between border rounded-md px-3 py-2 gap-2"
        >
          <Badge variant="secondary" className="capitalize">
            {type}
          </Badge>
          <span className="font-medium">{formatNumber(count)}</span>
        </div>
      ))}
    </CardContent>
  </Card>
);

const MetadataStatusCard = ({ items }: { items: MetadataItem[] }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">Metadata Status</CardTitle>
      <CardDescription>
        AI extraction pipeline outcomes for active cards.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex justify-between items-center py-1"
        >
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium">{formatNumber(item.value)}</span>
        </div>
      ))}
      <Separator className="my-2" />
      <div className="flex justify-between text-muted-foreground">
        <span>Total tracked</span>
        <span className="font-medium">
          {formatNumber(items.reduce((sum, item) => sum + item.value, 0))}
        </span>
      </div>
    </CardContent>
  </Card>
);

const PipelineHealthCard = ({
  summary,
  stageList,
}: {
  summary: NormalizedPipelineSummary;
  stageList: StageListEntry[];
}) => (
  <Card>
    <CardHeader className="space-y-1">
      <CardTitle className="text-base">AI Enrichment Health</CardTitle>
      <CardDescription>
        Track enrichment backlog and spot stuck pipeline stages.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <MetricChip
          label="Missing metadata"
          value={summary.missingAiMetadata}
        />
        <MetricChip label="In progress" value={summary.pendingEnrichment} />
        <MetricChip label="Needs attention" value={summary.failedCards} />
      </div>

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
          Pipeline stage breakdown
        </p>
        <div className="grid gap-3">
          {stageList.map(({ key, label, summary }) => (
            <div key={key} className="border rounded-md p-3">
              <p className="font-medium mb-2">{label}</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <StageMetric label="Pending" value={summary.pending} />
                <StageMetric label="In progress" value={summary.inProgress} />
                <StageMetric label="Failed" value={summary.failed} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </CardContent>
  </Card>
);

const MetricChip = ({ label, value }: { label: string; value: number }) => (
  <div className="text-center p-3 border rounded-md">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="text-2xl font-semibold">{formatNumber(value)}</p>
  </div>
);

const StageMetric = ({ label, value }: { label: string; value: number }) => (
  <div>
    <span className="text-muted-foreground">{label}: </span>
    <span className="font-semibold">{formatNumber(value)}</span>
  </div>
);

const MissingCardsCard = ({
  missingCards,
  pendingRetries,
  retryingCardId,
  handleCardRetry,
}: {
  missingCards: MissingCard[];
  pendingRetries: Record<string, number>;
  retryingCardId: string | null;
  handleCardRetry: (cardId: string) => Promise<void>;
}) => (
  <Card>
    <CardHeader className="space-y-1">
      <CardTitle className="text-base">Cards Pending AI Enrichment</CardTitle>
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
                <TableHead>Type</TableHead>
                <TableHead>Metadata</TableHead>
                <TableHead className="hidden md:table-cell">Issues</TableHead>
                <TableHead className="hidden md:table-cell">
                  Pipeline Status
                </TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missingCards.map((card) => (
                <TableRow key={card.cardId}>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {card.type}
                    </Badge>
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
);
