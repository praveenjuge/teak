import {
  type AccountDeletionParams,
  type CardProcessingParams,
  type ExportParams,
  type ImportParams,
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

export const exportRunParamsValidator = readAs<ExportParams>()(
  v.object({
    jobId: v.id("exportJobs"),
    userId: v.string(),
  })
);

export const importRunParamsValidator = readAs<ImportParams>()(
  v.object({
    jobId: v.id("importJobs"),
  })
);

export const accountDeletionRunParamsValidator =
  readAs<AccountDeletionParams>()(
    v.object({
      generation: v.number(),
      stateId: v.id("accountDeletionStates"),
    })
  );

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

/**
 * Every kind of `workflowDispatches` row and the params it carries. The
 * table's `kind` and `params` validators come from this list, and the
 * dispatcher keeps one handler per entry (`DispatchKindSpec`), so adding a
 * kind is one line here plus its handler. `deleteObjects` rows carry keys,
 * not params.
 */
export const DISPATCH_PARAMS = {
  cardProcessing: cardProcessingParamsValidator,
  export: exportRunParamsValidator,
  import: importRunParamsValidator,
  accountDeletion: accountDeletionRunParamsValidator,
  maintenance: maintenanceRunParamsValidator,
  deleteObjects: null,
  analyticsEvent: analyticsEventParamsValidator,
} as const;

export type DispatchKind = keyof typeof DISPATCH_PARAMS;

export const DISPATCH_KINDS = Object.keys(DISPATCH_PARAMS) as DispatchKind[];

/** What a row of `kind` carries in `params`. */
export type DispatchParams<Kind extends DispatchKind> =
  Kind extends DispatchKind
    ? (typeof DISPATCH_PARAMS)[Kind] extends { type: infer Params }
      ? Params
      : undefined
    : never;

export const workflowDispatchKindValidator = v.union(
  ...DISPATCH_KINDS.map((kind) => v.literal(kind))
);

type ParamsValidator = NonNullable<(typeof DISPATCH_PARAMS)[DispatchKind]>;

/** `workflowDispatches.params`: one shape per kind. */
export const workflowDispatchParamsValidator = v.union(
  ...Object.values(DISPATCH_PARAMS).filter(
    (validator): validator is ParamsValidator => validator !== null
  )
);
