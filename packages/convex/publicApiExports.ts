/**
 * Public API exports: start a full-account ZIP export and read the latest
 * export, with a short-lived download URL once it is ready. Same jobs, quota
 * (one export per 7 days) and artifact as the web Export panel.
 */
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, httpAction } from "./_generated/server";
import { readExportDownloadUrl } from "./dataExport";
import { withAuthorizedUser } from "./publicApiHttpAuth";
import { errorResponse, json } from "./publicApiHttpShared";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";
import type { WorkosResource } from "./workosTokens";

interface ExportSummary {
  artifactBytes?: number;
  cardCount?: number;
  completedAt?: number;
  createdAt: number;
  downloadAvailable: boolean;
  expiresAt?: number;
  failureClass?: string;
  filesIncluded?: number;
  filesOmitted?: number;
  id: Id<"exportJobs">;
  processedCount?: number;
  stage?: "snapshotting" | "archiving";
  status: string;
  updatedAt: number;
}

const serializeExport = (job: ExportSummary, downloadUrl: string | null) => ({
  id: job.id,
  status: job.status,
  stage: job.stage ?? null,
  processedCount: job.processedCount ?? null,
  cardCount: job.cardCount ?? null,
  filesIncluded: job.filesIncluded ?? null,
  filesOmitted: job.filesOmitted ?? null,
  sizeBytes: job.artifactBytes ?? null,
  failureClass: job.failureClass ?? null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt ?? null,
  expiresAt: job.expiresAt ?? null,
  downloadUrl,
});

export async function handleLatestExportRequest(
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;
  try {
    const latest: {
      canStartNew: boolean;
      job: ExportSummary | null;
      quotaResetMs: number;
    } = await ctx.runQuery(internal.dataExport.getLatestExportForUser, {
      userId,
    });
    const download = latest.job?.downloadAvailable
      ? await readExportDownloadUrl(ctx, userId, latest.job.id)
      : null;
    return json(200, {
      job: latest.job
        ? serializeExport(latest.job, download?.url ?? null)
        : null,
      canStartNew: latest.canStartNew,
      nextAvailableAt:
        latest.quotaResetMs > 0 ? Date.now() + latest.quotaResetMs : null,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load export");
  }
}

export async function handleStartExportRequest(
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  try {
    const result: {
      job?: ExportSummary;
      quotaResetMs?: number;
      reason?: "already_active" | "quota_exceeded";
      started: boolean;
    } = await ctx.runMutation(internal.dataExport.startExportForUser, {
      userId: auth.validated.userId,
    });
    if (result.started && result.job) {
      return json(202, { job: serializeExport(result.job, null) });
    }
    if (result.reason === "already_active" && result.job) {
      return errorResponse(409, "CONFLICT", "An export is already running", {
        job: serializeExport(result.job, null),
      });
    }
    const retryAt = Date.now() + (result.quotaResetMs ?? 0);
    return errorResponse(
      429,
      "RATE_LIMITED",
      "You can start one export every 7 days",
      { retryAt },
      {
        "Retry-After": String(
          Math.max(1, Math.ceil((result.quotaResetMs ?? 0) / 1000))
        ),
      }
    );
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to start export");
  }
}

export const exportsV1 = httpAction(async (ctx, request) =>
  withPublicApiGatewayHeaders(
    request.method === "POST"
      ? await handleStartExportRequest(ctx, request)
      : await handleLatestExportRequest(ctx, request)
  )
);
