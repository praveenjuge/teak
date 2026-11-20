import type { SearchQualifierKey } from "./search/qualifiers";
import { ignoreTelemetryError } from "./telemetry";

export type CardCreationSource =
  | "web"
  | "apple"
  | "android"
  | "mobile"
  | "extension"
  | "raycast"
  | "cli"
  | "api"
  | "mcp"
  | "share_intent"
  | "drag_drop"
  | "import"
  | "paste"
  | "email"
  | "unknown";

export type SizeBucket = "<1MB" | "1-10MB" | "10-100MB" | ">100MB";

export const EMAIL_RECEIVED_OUTCOMES = [
  "saved",
  "dropped_limit",
  "dropped_rate",
  "deferred_rate",
  "empty",
  "duplicate",
] as const;
export type EmailReceivedOutcome = (typeof EMAIL_RECEIVED_OUTCOMES)[number];

export const EMAIL_ATTACHMENT_SKIP_REASONS = [
  "format",
  "size",
  "limit",
] as const;
export type EmailAttachmentSkipReason =
  (typeof EMAIL_ATTACHMENT_SKIP_REASONS)[number];

export type CardDoneSource = "panel" | "api";

interface CardDoneToggled {
  category: string;
  done: boolean;
  source: CardDoneSource;
}

export type CardPinSource = "grid" | "dialog" | "shortcut" | "api";

interface CardPinToggled {
  pinned: boolean;
  source: CardPinSource;
}

interface CardPinsReordered {
  count: number;
  source: "strip" | "api";
}

export type LinkPdfSaveSource = "panel" | "api";

export type ThumbnailReplaceSource = "drop" | "paste" | "pick" | "api";

type NoProperties = Record<string, never>;

/**
 * Where a free account was asked to upgrade: the toast after a save the card
 * limit refused (`save_toast`), the toast the composer shows when it opens at
 * the limit (`composer_toast`), a link paste that stopped at the limit
 * (`paste_toast`), or the Upgrade button in Settings (`settings`, clicks
 * only).
 */
export type UpgradePlacement =
  | "save_toast"
  | "composer_toast"
  | "paste_toast"
  | "settings";

/**
 * Who archived or deleted a card: `app` for the signed-in web and native apps
 * (one card or a selection), or the public API caller's source
 * (`publicApi/http/callerSource.ts`).
 */
export type CardChangeSource =
  | "app"
  | "api"
  | "cli"
  | "raycast"
  | "extension"
  | "mcp";

/** The app a new account signed up in (`workosBootstrap:ensureUser`). */
export const SIGNUP_PLATFORMS = ["web", "apple", "android"] as const;
export type SignupPlatform = (typeof SIGNUP_PLATFORMS)[number] | "unknown";

/** How a new account signed in, from WorkOS's `authenticationMethod`. */
export const SIGNUP_METHODS = [
  "google",
  "apple",
  "github",
  "microsoft",
  "password",
  "magic_auth",
  "passkey",
  "sso",
  "other",
] as const;
export type SignupMethod = (typeof SIGNUP_METHODS)[number];

const WORKOS_METHODS: Readonly<Record<string, SignupMethod>> = {
  AppleOAuth: "apple",
  GitHubOAuth: "github",
  GoogleOAuth: "google",
  MagicAuth: "magic_auth",
  MicrosoftOAuth: "microsoft",
  Passkey: "passkey",
  Password: "password",
  SSO: "sso",
};

/** WorkOS's `authenticationMethod` (`GoogleOAuth`…) as a signup method. */
export const signupMethodFromWorkos = (
  method: string | undefined
): SignupMethod | undefined =>
  method ? (WORKOS_METHODS[method] ?? "other") : undefined;

export type DeadLinkCheckOutcome =
  | "alive"
  | "dead"
  | "unsure"
  | "cached_alive"
  | "cached_dead";

export interface ClientEventCatalog {
  archived_copy_opened: { surface: "open_page" };
  card_backlink_opened: NoProperties;
  card_create_submitted: {
    card_type: string;
    source: CardCreationSource;
    via?: string;
  };
  card_done_toggled: CardDoneToggled;
  /** A save the free card limit refused, seen by the app that tried it. */
  card_limit_reached: { source: CardCreationSource };
  /** A card's detail view opened. */
  card_opened: { card_type: string; surface: "web" | "apple" | "android" };
  card_pin_toggled: CardPinToggled;
  card_pins_reordered: CardPinsReordered;
  card_thumbnail_replaced: { source: ThumbnailReplaceSource };
  card_thumbnail_reset: NoProperties;
  checkout_opened: NoProperties;
  checkout_started: NoProperties;
  /**
   * Opening a link card with an archived copy checked its page. `reason` is
   * the check's short code (`http_404`, `dns`, `timeout`, `rate_limited`…),
   * never the URL.
   */
  dead_link_checked: { outcome: DeadLinkCheckOutcome; reason?: string };
  export_completed: NoProperties;
  export_failed: { error_class?: string };
  export_started: NoProperties;
  extension_card_saved: { card_type?: string; via?: string };
  extension_omnibox_used: { result: "card" | "search" };
  file_upload_completed: { bucket: string; size_bucket: SizeBucket };
  file_upload_failed: {
    bucket: string;
    error_class?: string;
    size_bucket?: SizeBucket;
  };
  import_completed: NoProperties;
  import_failed: { error_class?: string };
  import_started: NoProperties;
  link_pdf_saved: { source: LinkPdfSaveSource };
  locale_changed: { from: string; to: string };
  reader_opened: {
    category: string;
    surface: "modal";
    words_bucket: string;
  };
  revisit_finished: { archived: number; completed: boolean; kept: number };
  revisit_started: NoProperties;
  search_operator_used: { groups: boolean; negation: boolean; or: boolean };
  search_performed: {
    qualifiers?: SearchQualifierKey[];
    zero_result: boolean;
  };
  signed_in: NoProperties;
  similar_search_opened: { source: "panel" };
  upgrade_clicked: { placement: UpgradePlacement };
  upgrade_prompt_shown: { placement: UpgradePlacement };
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
  /**
   * One REST call to the public API (`publicApi/http/router.ts`); MCP calls
   * send `mcp_tool_called` instead. `route` is the operation id, never the
   * path; `error_code` is the API's error code for a 4xx or 5xx.
   */
  api_request: {
    caller_source: string;
    duration_ms: number;
    error_code?: string;
    outcome: "ok" | "error" | "unauthorized";
    route: string;
    status: number;
  };
  article_extracted: {
    outcome: "article" | "none" | "failed";
    words_bucket: string;
  };
  billing_portal_opened: NoProperties;
  card_archived: { source: CardChangeSource };
  card_create_failed: {
    card_type: string;
    error_class?: string;
    source: string;
  };
  card_created: { card_type: string; source: string };
  /** A card moved to Trash. */
  card_deleted: { source: CardChangeSource };
  card_done_toggled: CardDoneToggled;
  /** A save the free card limit refused, where the backend saw it. */
  card_limit_reached: { source: string };
  card_pin_toggled: CardPinToggled;
  card_pins_reordered: CardPinsReordered;
  card_processing_completed: {
    ai_language?: string;
    card_type: string;
    duration_ms: number;
  };
  card_processing_failed: {
    card_type?: string;
    error_class: string;
    stage: string;
  };
  card_resaved: { source: string; was_archived: boolean };
  card_thumbnail_replaced: { source: ThumbnailReplaceSource };
  card_thumbnail_reset: NoProperties;
  checkout_completed: NoProperties;
  checkout_failed: { error_class: string };
  email_attachment_saved: { kind: string; size_bucket: SizeBucket };
  email_attachment_skipped: { reason: EmailAttachmentSkipReason };
  email_received: { outcome: EmailReceivedOutcome };
  email_save_toggled: { enabled: boolean };
  highlight_created: {
    count?: number;
    merged: boolean;
    source: "reader" | "api" | "import";
  };
  highlight_note_saved: { cleared: boolean; source: "reader" | "api" };
  highlight_removed: { source: "reader" | "api" };
  link_paste_saved: {
    count: number;
    created: number;
    resaved: number;
    stopped_at_limit: boolean;
  };
  link_pdf_saved: { source: LinkPdfSaveSource };
  mcp_tool_called: {
    duration_ms: number;
    outcome: "ok" | "error" | "unauthorized";
    status?: number;
    tool: string;
  };
  page_archive_failed: {
    reason: string;
    source: "extension" | "server";
    /** The page's HTTP status, when the site answered with an error. */
    status?: number;
  };
  page_archived: {
    bytes_bucket: SizeBucket;
    duration_ms_bucket: string;
    kind: "full" | "text_only";
    source: "extension" | "server";
  };
  subscription_ended: NoProperties;
  user_signed_up: {
    method?: SignupMethod;
    platform?: SignupPlatform;
    source?: string;
  };
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
  const recorder = activeRecorder;
  if (!recorder) {
    return;
  }
  ignoreTelemetryError(() =>
    recorder.capture(event, { ...(properties ?? {}) })
  );
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
