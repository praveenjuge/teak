import {
  buildMobileRelease,
  resolveTelemetryEnvironment,
  resolveTraceSampleRate,
  scrubTelemetryValue,
  type TelemetryEnvironment,
} from "@teak/convex/shared/telemetry";
import * as Crypto from "expo-crypto";

export const resolveMobileEnvironment = (
  explicit = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  nodeEnvironment = process.env.NODE_ENV
): TelemetryEnvironment =>
  resolveTelemetryEnvironment({ explicit, nodeEnvironment });

export const resolveMobileDsn = (): string | undefined =>
  process.env.EXPO_PUBLIC_SENTRY_MOBILE_DSN?.trim() || undefined;

export const resolveMobileRelease = (
  appVersion: string | null | undefined,
  buildNumber: string | number | null | undefined
): string | undefined =>
  buildMobileRelease(appVersion ?? undefined, buildNumber ?? undefined);

export const mobileTracesSampler = (context: {
  attributes?: Record<string, unknown>;
  name?: string;
}): number =>
  resolveTraceSampleRate({
    environment: resolveMobileEnvironment(),
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

interface MobileErrorEvent {
  exception?: {
    values?: {
      stacktrace?: { frames?: { filename?: string; function?: string }[] };
      type?: string;
    }[];
  };
}

const isSystemPointerInteractionHang = (event: MobileErrorEvent): boolean =>
  event.exception?.values?.some((exception) => {
    const frames = exception.stacktrace?.frames ?? [];
    return (
      exception.type === "App Hang Non Fully Blocked" &&
      frames.some(
        (frame) => frame.function === "-[_UIPointerInteractionAssistant init]"
      ) &&
      frames.every((frame) => !frame.filename)
    );
  }) ?? false;

export const filterMobileSentryEvent = <T extends MobileErrorEvent>(
  event: T
): T | null =>
  isSystemPointerInteractionHang(event)
    ? null
    : (scrubTelemetryValue(event) as T);

export const scrubMobilePayload = <T>(payload: T): T =>
  scrubTelemetryValue(payload) as T;

export const resolvePseudonymousUserId = async (
  userId: string | null | undefined
): Promise<string | undefined> =>
  userId
    ? await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        userId
      )
    : undefined;
