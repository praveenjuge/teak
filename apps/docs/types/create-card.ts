/**
 * Documented create-card body fields for the public REST API.
 * Used by AutoTypeTable in the API guide so the table stays close to the SDK.
 */
export interface CreateCardBody {
  /**
   * Optional card type. Set to `text` to store raw Markdown exactly; omit it to
   * keep automatic URL, quote, and palette detection.
   * @default inferred
   */
  cardType?:
    | "text"
    | "link"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "palette"
    | "quote";
  /**
   * Markdown or plain text body for the card. Prefer this for notes; use `url`
   * when saving a link.
   */
  content?: string;
  /** Free-form notes attached to the card. */
  notes?: string;
  /** Where the card was saved from (extension, CLI, API, and so on). */
  source?: string;
  /** Tags to apply on create. */
  tags?: string[];
  /**
   * URL to save as a link card. Teak may classify the type automatically when
   * `cardType` is omitted.
   */
  url?: string;
}
