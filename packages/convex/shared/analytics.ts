import type { SearchQualifierKey } from "./search/qualifiers";
import { ignoreTelemetryError } from "./telemetry";

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
  | "email"
  | "unknown";

export type SizeBucket = "<1MB" | "1-10MB" | "10-100MB" | ">100MB";

/**
 * `dropped_limit` is the free card limit, `dropped_rate` the 60-an-hour
 * inbound limit (both silent), `deferred_rate` the card creation bucket (the
 * sender retries).
 */
export type EmailReceivedOutcome =
  | "saved"
  | "dropped_limit"
  | "dropped_rate"
  | "deferred_rate"
  | "empty"
  | "duplicate";

export type EmailAttachmentSkipReason = "format" | "size" | "limit";

export type CardDoneSource = "panel" | "api";

interface CardDoneToggled {
  category: string;
  done: boolean;
  source: CardDoneSource;
}

export type LinkPdfSaveSource = "panel" | "api";

export type ThumbnailReplaceSource = "drop" | "paste" | "pick" | "api";

type NoProperties = Record<string, never>;

/**
 * What opening a link card with an archived copy found: a fresh check's
 * outcome, or the cached one (alive for 24 hours, dead for 6).
 */
export type DeadLinkCheckOutcome =
  | "alive"
  | "dead"
  | "unsure"
  | "cached_alive"
  | "cached_dead";

export interface ClientEventCatalog {
  /** The archived copy of a link whose page is gone was shown. */
  archived_copy_opened: { surface: "open_page" };
  card_backlink_opened: NoProperties;
  card_create_submitted: {
    card_type: string;
    source: CardCreationSource;
    via?: string;
  };
  card_done_toggled: CardDoneToggled;
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
  /**
   * The Read tab showed a link's article. `category` is the link category
   * (or `none`), `words_bucket` the article's length (`articleWordsBucket`).
   */
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
   * "extract article" finished for a link: `article`, `none` (the page isn't
   * an article) or `failed`; `words_bucket` is the article's length.
   */
  article_extracted: {
    outcome: "article" | "none" | "failed";
    words_bucket: string;
  };
  billing_portal_opened: NoProperties;
  card_create_failed: {
    card_type: string;
    error_class?: string;
    source: string;
  };
  card_created: { card_type: string; source: string };
  card_done_toggled: CardDoneToggled;
  card_processing_completed: {
    /** The language AI wrote the tags and summary in (`ja`, `es`), if any. */
    ai_language?: string;
    card_type: string;
    duration_ms: number;
  };
  card_processing_failed: {
    card_type?: string;
    error_class: string;
    stage: string;
  };
  /**
   * A link saved again: the card already in Teak moved to the top instead of
   * a second card. `source` is `card_created`'s; `was_archived` says it also
   * came back from Archive.
   */
  card_resaved: { source: string; was_archived: boolean };
  card_thumbnail_replaced: { source: ThumbnailReplaceSource };
  card_thumbnail_reset: NoProperties;
  checkout_completed: NoProperties;
  checkout_failed: { error_class: string };
  /** A file attached to a saved email became its own card. */
  email_attachment_saved: { kind: string; size_bucket: SizeBucket };
  /** An attachment that wasn't saved, and why. */
  email_attachment_skipped: { reason: EmailAttachmentSkipReason };
  /** Save by email: what happened to one email from an account's owner. */
  email_received: { outcome: EmailReceivedOutcome };
  /** Save by email turned on or off in Settings. */
  email_save_toggled: { enabled: boolean };
  /**
   * A list of links pasted into the web composer finished saving. `count` is
   * the links the job kept (at most 100); `created` and `resaved` split the
   * ones saved; `stopped_at_limit` says the free card limit ended it early.
   */
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
  /**
   * A link's page couldn't be saved as a copy. `reason` is the stage's
   * (`blocked_url`, `too_large`, `http_error`, `not_html`, `unreachable`,
   * `archive_error`); `source` whether the extension sent the page.
   */
  page_archive_failed: {
    reason: string;
    source: "extension" | "server";
  };
  /**
   * A link's page was saved as a copy: `kind` is `full` or `text_only`,
   * `source` `extension` (the page as the browser showed it) or `server`.
   */
  page_archived: {
    bytes_bucket: SizeBucket;
    duration_ms_bucket: string;
    kind: "full" | "text_only";
    source: "extension" | "server";
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
