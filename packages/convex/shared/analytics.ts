/**
 * Teak's typed product-event catalog.
 *
 * Client surfaces (web, extension popup) call `captureEvent`; the host wires a
 * recorder at startup with `configureAnalytics`. Until then, every call is a
 * no-op.
 * Server events are sent from Convex with `captureBackendEvent`.
 *
 * Keep properties low-cardinality and free of user content.
 */

export type CardCreationSource =
  | "web"
  | "apple"
  | "android"
  | "mobile"
  | "extension"
  | "raycast"
  | "api"
  | "mcp"
  | "share_intent"
  | "drag_drop"
  | "import"
  | "paste"
  | "unknown";

export type SizeBucket = "<1MB" | "1-10MB" | "10-100MB" | ">100MB";

type NoProperties = Record<string, never>;

export interface ClientEventCatalog {
  card_create_submitted: {
    card_type: string;
    source: CardCreationSource;
    via?: string;
  };
  checkout_opened: NoProperties;
  checkout_started: NoProperties;
  export_completed: NoProperties;
  export_failed: { error_class?: string };
  export_started: NoProperties;
  extension_card_saved: { card_type?: string; via?: string };
  file_upload_completed: { bucket: string; size_bucket: SizeBucket };
  file_upload_failed: {
    bucket: string;
    error_class?: string;
    size_bucket?: SizeBucket;
  };
  import_completed: NoProperties;
  import_failed: { error_class?: string };
  import_started: NoProperties;
  search_performed: { zero_result: boolean };
  signed_in: NoProperties;
}

export interface ServerEventCatalog {
  $ai_generation: {
    $ai_error?: string;
    $ai_input_tokens?: number;
    $ai_is_error: boolean;
    $ai_latency: number;
    $ai_model: string;
    $ai_output_tokens?: number;
    $ai_provider: string;
    $ai_span_name: string;
    $ai_total_cost_usd?: number;
    $ai_trace_id?: string;
  };
  billing_portal_opened: NoProperties;
  card_create_failed: {
    card_type: string;
    error_class?: string;
    source: string;
  };
  card_created: { card_type: string; source: string };
  card_processing_completed: { card_type: string; duration_ms: number };
  card_processing_failed: {
    card_type?: string;
    error_class: string;
    stage: string;
  };
  checkout_completed: NoProperties;
  checkout_failed: { error_class: string };
  mcp_tool_called: {
    duration_ms: number;
    outcome: "ok" | "error" | "unauthorized";
    status?: number;
    tool: string;
  };
  subscription_ended: NoProperties;
  user_signed_up: { source?: string };
}

export type ClientEventName = keyof ClientEventCatalog;
export type ServerEventName = keyof ServerEventCatalog;

export interface AnalyticsRecorder {
  capture: (event: string, properties: Record<string, unknown>) => void;
}

let activeRecorder: AnalyticsRecorder | undefined;

export const configureAnalytics = (recorder: AnalyticsRecorder): void => {
  activeRecorder = recorder;
};

export const resetAnalytics = (): void => {
  activeRecorder = undefined;
};

export const captureEvent = <Name extends ClientEventName>(
  event: Name,
  ...[properties]: ClientEventCatalog[Name] extends NoProperties
    ? [properties?: ClientEventCatalog[Name]]
    : [properties: ClientEventCatalog[Name]]
): void => {
  if (!activeRecorder) {
    return;
  }
  try {
    activeRecorder.capture(event, { ...(properties ?? {}) });
  } catch {
    // Analytics must never alter product behavior.
  }
};

const MEGABYTE = 1024 * 1024;

export const resolveSizeBucket = (bytes: number): SizeBucket => {
  if (bytes < MEGABYTE) {
    return "<1MB";
  }
  if (bytes < 10 * MEGABYTE) {
    return "1-10MB";
  }
  if (bytes < 100 * MEGABYTE) {
    return "10-100MB";
  }
  return ">100MB";
};
