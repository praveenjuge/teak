import {
  type CardProcessingParams,
  MAINTENANCE_TASKS,
  type MaintenanceParams,
} from "@teak/files-protocol";
import { v } from "convex/values";

/** Checks at compile time that a stored shape is what the Worker reads. */
const readAs =
  <Shape>() =>
  <Validator extends { type: Shape }>(validator: Validator): Validator =>
    validator;

const onlyWhenTrue = v.optional(v.literal(true));

export const cardProcessingParamsValidator = readAs<CardProcessingParams>()(
  v.object({
    archiveOnly: onlyWhenTrue,
    articleOnly: onlyWhenTrue,
    cardId: v.id("cards"),
    metadataOnly: onlyWhenTrue,
    refresh: onlyWhenTrue,
    rev: v.number(),
  })
);

export const exportRunParamsValidator = v.object({
  jobId: v.id("exportJobs"),
  userId: v.string(),
});

export const importRunParamsValidator = v.object({
  jobId: v.id("importJobs"),
});

export const accountDeletionRunParamsValidator = v.object({
  generation: v.number(),
  stateId: v.id("accountDeletionStates"),
});

export const maintenanceRunParamsValidator = readAs<MaintenanceParams>()(
  v.object({
    date: v.optional(v.string()),
    dispatched: v.literal(true),
    task: v.union(...MAINTENANCE_TASKS.map((task) => v.literal(task))),
  })
);

/** An `AnalyticsEventItem` without its `type`, which the claim adds. */
export const analyticsEventParamsValidator = v.object({
  appVersion: v.optional(v.string()),
  distinctId: v.optional(v.string()),
  event: v.string(),
  properties: v.any(),
  set: v.optional(v.any()),
  timestamp: v.string(),
  uuid: v.string(),
});

/** `workflowDispatches.params`: one shape per kind; `deleteObjects` has none. */
export const workflowDispatchParamsValidator = v.union(
  cardProcessingParamsValidator,
  exportRunParamsValidator,
  importRunParamsValidator,
  accountDeletionRunParamsValidator,
  maintenanceRunParamsValidator,
  analyticsEventParamsValidator
);
