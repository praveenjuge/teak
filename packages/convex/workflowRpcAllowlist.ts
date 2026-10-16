// The Convex functions the Files Worker's workflows and queues may call over
// the workflow RPC gateway (workflowGateway.ts). Anything else is refused,
// so the signing secret can't reach the rest of the backend's internal
// functions. Names are `path:export`, as `getFunctionName` gives them.
// Worker tests check every name they call is listed here.

export const WORKFLOW_RPC_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  // Workflow lifecycle (workflowDispatch.ts).
  "workflowDispatch:complete",
  "workflowDispatch:listStale",
  "workflowDispatch:pruneFinished",
  // Cron heartbeats for the tasks Cloudflare runs.
  "adminHealth:recordCronRun",
  // Hourly AI usage rollup from Analytics Engine (src/aiUsageRollup.ts).
  "adminUsage:replaceDailyUsage",
  // WorkOS events the webhook queue gave up on (src/queues/workosEvents.ts).
  "workosWebhook:recordUndeliverable",
  // Card processing (apps/files-worker/src/workflows/cardProcessing) and the
  // AI backfill queue. Every mutation runs guarded by the card's revision.
  "adminAccess:getAiGate",
  "adminAccess:isLinkFetchPaused",
  "ai/backfill:claimAiBackfillCards",
  "ai/mutations:updateCardProcessing",
  "card/documentText:saveDocumentText",
  "card/processingRpc:getCardForProcessing",
  "card/processingRpc:markStagesInProgress",
  "linkMetadata:getCardForLinkFetch",
  "linkMetadata:getCardForScreenshot",
  "linkMetadata:updateCardMetadata",
  "linkMetadata:updateCardScreenshot",
  "storage/ownership:registerObject",
  "workflows/aiMetadata/mutations:updateCardAI",
  "workflows/aiMetadata/mutations:updateCardColors",
  "workflows/steps/categorization/mutations:updateCategorization",
  "workflows/steps/classificationMutations:recordClassification",
  "workflows/steps/renderables/mutations:markCardRenderablesFailed",
  "workflows/steps/renderables/mutations:updateCardFileMetadata",
  "workflows/steps/renderables/mutations:updateCardFilePreview",
  "workflows/steps/renderables/mutations:updateCardMediaFacts",
  "workflows/steps/renderables/mutations:updateCardThumbnail",
  // Exports (src/workflows/export.ts). Archive writes also register each
  // object first with storage/ownership:registerObject, listed above.
  "dataExport:completeExport",
  "dataExport:deleteJobItemsPage",
  "dataExport:failExport",
  "dataExport:getExportCardsPage",
  "dataExport:getExportFolderNames",
  "dataExport:isCancelRequested",
  "dataExport:markRunning",
  "dataExport:recordExportProgress",
  "dataExport:recordSnapshotPage",
  // Imports (src/workflows/import.ts).
  "dataImport:createPendingBatch",
  "dataImport:failItems",
  "dataImport:finishJob",
  "dataImport:getFailureReportRows",
  "dataImport:getPendingItems",
  "dataImport:getUnclaimedFileKeysPage",
  "dataImport:getWorkflowJob",
  "dataImport:insertItems",
  "dataImport:setExtractedFile",
  "dataImport:setPhase",
  "import/sourceVersion:bind",
  // Account deletion (src/workflows/accountDeletion.ts). Stages that need
  // provider credentials stay in the runStage action.
  "accountDeletion:beginAccountDataDeletion",
  "accountDeletion:removeAccountCardUsage",
  "accountDeletionActions:runStage",
  "accountDeletionData:ancillaryPage",
  "accountDeletionData:cancelJobsPage",
  "accountDeletionData:checkpointStorageBatch",
  "accountDeletionData:checkpointWriters",
  "accountDeletionData:prepareStorageBatch",
  "accountDeletionJobs:advance",
  "accountDeletionJobs:finalize",
  "accountDeletionJobs:getState",
  "accountDeletionJobs:recordFailure",
  "embedding/state:accountEmbeddingsPage",
  "embedding/state:forgetAccountEmbeddings",
  // Maintenance (src/workflows/maintenance.ts).
  "card/trashCleanup:cleanupDeletedCard",
  "card/trashCleanup:getCardsPendingCleanup",
  "dataExport:expireJob",
  "dataExport:findExpiredReadyJobs",
  "embedding/sweep:sweepVectorLedger",
  "publicApiTombstones:pruneExpiredCardTombstones",
  "storage/orphanSweep:collectNonCardReferencedKeys",
  "storage/orphanSweep:listPrefix",
  "storage/orphanSweep:logOrphanReport",
  "storage/orphanSweep:pageSweepCards",
]);

export const isWorkflowRpcFunction = (name: string): boolean =>
  WORKFLOW_RPC_FUNCTIONS.has(name);
