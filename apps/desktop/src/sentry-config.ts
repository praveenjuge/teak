import {
  buildDesktopRelease,
  hashTelemetryId,
  resolveTelemetryEnvironment,
  resolveTraceSampleRate,
  scrubTelemetryValue,
  type TelemetryEnvironment,
} from "@teak/convex/shared/telemetry";

export const resolveDesktopEnvironment = (
  explicit?: string,
  nodeEnvironment?: string
): TelemetryEnvironment =>
  resolveTelemetryEnvironment({ explicit, nodeEnvironment });

export const resolveDesktopDsn = (explicit?: string): string | undefined =>
  explicit?.trim() || undefined;

export const resolveDesktopRelease = (
  version: string | undefined,
  sha: string | undefined,
  explicit?: string
): string | undefined => explicit?.trim() || buildDesktopRelease(version, sha);

export const desktopTracesSampler = (
  context: {
    attributes?: Record<string, unknown>;
    name?: string;
  },
  environment: TelemetryEnvironment
): number =>
  resolveTraceSampleRate({
    environment,
    name: context.name,
    operation:
      typeof context.attributes?.["sentry.op"] === "string"
        ? context.attributes["sentry.op"]
        : undefined,
    outcome:
      typeof context.attributes?.outcome === "string"
        ? context.attributes.outcome
        : undefined,
  });

export const scrubDesktopPayload = <T>(payload: T): T =>
  scrubTelemetryValue(payload) as T;

export const resolveDesktopUserId = async (
  deviceId: string | null | undefined
): Promise<string | undefined> =>
  deviceId ? await hashTelemetryId(deviceId) : undefined;
