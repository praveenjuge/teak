/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai_actions from "../ai/actions.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_mutations from "../ai/mutations.js";
import type * as ai_queries from "../ai/queries.js";
import type * as ai_schemas from "../ai/schemas.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as authNative from "../authNative.js";
import type * as billing from "../billing.js";
import type * as card_createCard from "../card/createCard.js";
import type * as card_defaultCards from "../card/defaultCards.js";
import type * as card_deleteCard from "../card/deleteCard.js";
import type * as card_findDuplicateCard from "../card/findDuplicateCard.js";
import type * as card_getCard from "../card/getCard.js";
import type * as card_getCards from "../card/getCards.js";
import type * as card_getFileUrl from "../card/getFileUrl.js";
import type * as card_migrations from "../card/migrations.js";
import type * as card_processingStatus from "../card/processingStatus.js";
import type * as card_queryUtils from "../card/queryUtils.js";
import type * as card_quoteFormatting from "../card/quoteFormatting.js";
import type * as card_updateCard from "../card/updateCard.js";
import type * as card_uploadCard from "../card/uploadCard.js";
import type * as card_validationUtils from "../card/validationUtils.js";
import type * as card_visualFilters from "../card/visualFilters.js";
import type * as cards from "../cards.js";
import type * as crons from "../crons.js";
import type * as dataExport from "../dataExport.js";
import type * as dataImport from "../dataImport.js";
import type * as devUrls from "../devUrls.js";
import type * as export_archiveBuilder from "../export/archiveBuilder.js";
import type * as export_constants from "../export/constants.js";
import type * as export_runExport from "../export/runExport.js";
import type * as export_serialize from "../export/serialize.js";
import type * as http from "../http.js";
import type * as idempotency from "../idempotency.js";
import type * as idempotencyAnalytics from "../idempotencyAnalytics.js";
import type * as import_bookmarks from "../import/bookmarks.js";
import type * as import_constants from "../import/constants.js";
import type * as import_r2Client from "../import/r2Client.js";
import type * as import_raindrop from "../import/raindrop.js";
import type * as import_runImport from "../import/runImport.js";
import type * as import_validate from "../import/validate.js";
import type * as importUpload from "../importUpload.js";
import type * as index from "../index.js";
import type * as linkMetadata from "../linkMetadata.js";
import type * as linkMetadata_instagram from "../linkMetadata/instagram.js";
import type * as linkMetadata_parsing from "../linkMetadata/parsing.js";
import type * as linkMetadata_selectors from "../linkMetadata/selectors.js";
import type * as linkMetadata_ssrf from "../linkMetadata/ssrf.js";
import type * as linkMetadata_types from "../linkMetadata/types.js";
import type * as linkMetadata_url from "../linkMetadata/url.js";
import type * as linkMetadata_x from "../linkMetadata/x.js";
import type * as migrations from "../migrations.js";
import type * as publicApi from "../publicApi.js";
import type * as publicApiHttp from "../publicApiHttp.js";
import type * as raycast from "../raycast.js";
import type * as sentry from "../sentry.js";
import type * as shared_apiKeyFormat from "../shared/apiKeyFormat.js";
import type * as shared_constants from "../shared/constants.js";
import type * as shared_index from "../shared/index.js";
import type * as shared_linkCategories from "../shared/linkCategories.js";
import type * as shared_metrics from "../shared/metrics.js";
import type * as shared_rateLimits from "../shared/rateLimits.js";
import type * as shared_search_constants from "../shared/search/constants.js";
import type * as shared_search_index from "../shared/search/index.js";
import type * as shared_search_localSearch from "../shared/search/localSearch.js";
import type * as shared_search_tokenization from "../shared/search/tokenization.js";
import type * as shared_types from "../shared/types.js";
import type * as shared_utils_colorUtils from "../shared/utils/colorUtils.js";
import type * as shared_utils_linkCategoryResolver from "../shared/utils/linkCategoryResolver.js";
import type * as shared_utils_linkDetection from "../shared/utils/linkDetection.js";
import type * as shared_utils_safeUrl from "../shared/utils/safeUrl.js";
import type * as shared_utils_timeSearch from "../shared/utils/timeSearch.js";
import type * as storage_r2 from "../storage/r2.js";
import type * as workflows_aiBackfill from "../workflows/aiBackfill.js";
import type * as workflows_aiMetadata_actions from "../workflows/aiMetadata/actions.js";
import type * as workflows_aiMetadata_generators from "../workflows/aiMetadata/generators.js";
import type * as workflows_aiMetadata_index from "../workflows/aiMetadata/index.js";
import type * as workflows_aiMetadata_mutations from "../workflows/aiMetadata/mutations.js";
import type * as workflows_aiMetadata_schemas from "../workflows/aiMetadata/schemas.js";
import type * as workflows_aiMetadata_transcript from "../workflows/aiMetadata/transcript.js";
import type * as workflows_aiMetadata_types from "../workflows/aiMetadata/types.js";
import type * as workflows_cardCleanup from "../workflows/cardCleanup.js";
import type * as workflows_cardProcessing from "../workflows/cardProcessing.js";
import type * as workflows_export from "../workflows/export.js";
import type * as workflows_exportCleanup from "../workflows/exportCleanup.js";
import type * as workflows_functionRefs from "../workflows/functionRefs.js";
import type * as workflows_import from "../workflows/import.js";
import type * as workflows_linkEnrichment from "../workflows/linkEnrichment.js";
import type * as workflows_linkMetadata from "../workflows/linkMetadata.js";
import type * as workflows_manager from "../workflows/manager.js";
import type * as workflows_screenshot from "../workflows/screenshot.js";
import type * as workflows_steps_categorization_index from "../workflows/steps/categorization/index.js";
import type * as workflows_steps_categorization_mutations from "../workflows/steps/categorization/mutations.js";
import type * as workflows_steps_categorization_providers_amazon from "../workflows/steps/categorization/providers/amazon.js";
import type * as workflows_steps_categorization_providers_common from "../workflows/steps/categorization/providers/common.js";
import type * as workflows_steps_categorization_providers_dribbble from "../workflows/steps/categorization/providers/dribbble.js";
import type * as workflows_steps_categorization_providers_github from "../workflows/steps/categorization/providers/github.js";
import type * as workflows_steps_categorization_providers_goodreads from "../workflows/steps/categorization/providers/goodreads.js";
import type * as workflows_steps_categorization_providers_imdb from "../workflows/steps/categorization/providers/imdb.js";
import type * as workflows_steps_categorization_providers_index from "../workflows/steps/categorization/providers/index.js";
import type * as workflows_steps_classification from "../workflows/steps/classification.js";
import type * as workflows_steps_classificationMutations from "../workflows/steps/classificationMutations.js";
import type * as workflows_steps_linkMetadata_fetchMetadata from "../workflows/steps/linkMetadata/fetchMetadata.js";
import type * as workflows_steps_linkMetadata_retryable from "../workflows/steps/linkMetadata/retryable.js";
import type * as workflows_steps_metadata from "../workflows/steps/metadata.js";
import type * as workflows_steps_palette from "../workflows/steps/palette.js";
import type * as workflows_steps_renderables from "../workflows/steps/renderables.js";
import type * as workflows_steps_renderables_generatePdfThumbnail from "../workflows/steps/renderables/generatePdfThumbnail.js";
import type * as workflows_steps_renderables_generateSvgThumbnail from "../workflows/steps/renderables/generateSvgThumbnail.js";
import type * as workflows_steps_renderables_generateThumbnail from "../workflows/steps/renderables/generateThumbnail.js";
import type * as workflows_steps_renderables_generateVideoThumbnail from "../workflows/steps/renderables/generateVideoThumbnail.js";
import type * as workflows_steps_renderables_mutations from "../workflows/steps/renderables/mutations.js";
import type * as workflows_steps_screenshot_captureScreenshot from "../workflows/steps/screenshot/captureScreenshot.js";
import type * as workflows_steps_screenshot_retryable from "../workflows/steps/screenshot/retryable.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "ai/actions": typeof ai_actions;
  "ai/models": typeof ai_models;
  "ai/mutations": typeof ai_mutations;
  "ai/queries": typeof ai_queries;
  "ai/schemas": typeof ai_schemas;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  authNative: typeof authNative;
  billing: typeof billing;
  "card/createCard": typeof card_createCard;
  "card/defaultCards": typeof card_defaultCards;
  "card/deleteCard": typeof card_deleteCard;
  "card/findDuplicateCard": typeof card_findDuplicateCard;
  "card/getCard": typeof card_getCard;
  "card/getCards": typeof card_getCards;
  "card/getFileUrl": typeof card_getFileUrl;
  "card/migrations": typeof card_migrations;
  "card/processingStatus": typeof card_processingStatus;
  "card/queryUtils": typeof card_queryUtils;
  "card/quoteFormatting": typeof card_quoteFormatting;
  "card/updateCard": typeof card_updateCard;
  "card/uploadCard": typeof card_uploadCard;
  "card/validationUtils": typeof card_validationUtils;
  "card/visualFilters": typeof card_visualFilters;
  cards: typeof cards;
  crons: typeof crons;
  dataExport: typeof dataExport;
  dataImport: typeof dataImport;
  devUrls: typeof devUrls;
  "export/archiveBuilder": typeof export_archiveBuilder;
  "export/constants": typeof export_constants;
  "export/runExport": typeof export_runExport;
  "export/serialize": typeof export_serialize;
  http: typeof http;
  idempotency: typeof idempotency;
  idempotencyAnalytics: typeof idempotencyAnalytics;
  "import/bookmarks": typeof import_bookmarks;
  "import/constants": typeof import_constants;
  "import/r2Client": typeof import_r2Client;
  "import/raindrop": typeof import_raindrop;
  "import/runImport": typeof import_runImport;
  "import/validate": typeof import_validate;
  importUpload: typeof importUpload;
  index: typeof index;
  linkMetadata: typeof linkMetadata;
  "linkMetadata/instagram": typeof linkMetadata_instagram;
  "linkMetadata/parsing": typeof linkMetadata_parsing;
  "linkMetadata/selectors": typeof linkMetadata_selectors;
  "linkMetadata/ssrf": typeof linkMetadata_ssrf;
  "linkMetadata/types": typeof linkMetadata_types;
  "linkMetadata/url": typeof linkMetadata_url;
  "linkMetadata/x": typeof linkMetadata_x;
  migrations: typeof migrations;
  publicApi: typeof publicApi;
  publicApiHttp: typeof publicApiHttp;
  raycast: typeof raycast;
  sentry: typeof sentry;
  "shared/apiKeyFormat": typeof shared_apiKeyFormat;
  "shared/constants": typeof shared_constants;
  "shared/index": typeof shared_index;
  "shared/linkCategories": typeof shared_linkCategories;
  "shared/metrics": typeof shared_metrics;
  "shared/rateLimits": typeof shared_rateLimits;
  "shared/search/constants": typeof shared_search_constants;
  "shared/search/index": typeof shared_search_index;
  "shared/search/localSearch": typeof shared_search_localSearch;
  "shared/search/tokenization": typeof shared_search_tokenization;
  "shared/types": typeof shared_types;
  "shared/utils/colorUtils": typeof shared_utils_colorUtils;
  "shared/utils/linkCategoryResolver": typeof shared_utils_linkCategoryResolver;
  "shared/utils/linkDetection": typeof shared_utils_linkDetection;
  "shared/utils/safeUrl": typeof shared_utils_safeUrl;
  "shared/utils/timeSearch": typeof shared_utils_timeSearch;
  "storage/r2": typeof storage_r2;
  "workflows/aiBackfill": typeof workflows_aiBackfill;
  "workflows/aiMetadata/actions": typeof workflows_aiMetadata_actions;
  "workflows/aiMetadata/generators": typeof workflows_aiMetadata_generators;
  "workflows/aiMetadata/index": typeof workflows_aiMetadata_index;
  "workflows/aiMetadata/mutations": typeof workflows_aiMetadata_mutations;
  "workflows/aiMetadata/schemas": typeof workflows_aiMetadata_schemas;
  "workflows/aiMetadata/transcript": typeof workflows_aiMetadata_transcript;
  "workflows/aiMetadata/types": typeof workflows_aiMetadata_types;
  "workflows/cardCleanup": typeof workflows_cardCleanup;
  "workflows/cardProcessing": typeof workflows_cardProcessing;
  "workflows/export": typeof workflows_export;
  "workflows/exportCleanup": typeof workflows_exportCleanup;
  "workflows/functionRefs": typeof workflows_functionRefs;
  "workflows/import": typeof workflows_import;
  "workflows/linkEnrichment": typeof workflows_linkEnrichment;
  "workflows/linkMetadata": typeof workflows_linkMetadata;
  "workflows/manager": typeof workflows_manager;
  "workflows/screenshot": typeof workflows_screenshot;
  "workflows/steps/categorization/index": typeof workflows_steps_categorization_index;
  "workflows/steps/categorization/mutations": typeof workflows_steps_categorization_mutations;
  "workflows/steps/categorization/providers/amazon": typeof workflows_steps_categorization_providers_amazon;
  "workflows/steps/categorization/providers/common": typeof workflows_steps_categorization_providers_common;
  "workflows/steps/categorization/providers/dribbble": typeof workflows_steps_categorization_providers_dribbble;
  "workflows/steps/categorization/providers/github": typeof workflows_steps_categorization_providers_github;
  "workflows/steps/categorization/providers/goodreads": typeof workflows_steps_categorization_providers_goodreads;
  "workflows/steps/categorization/providers/imdb": typeof workflows_steps_categorization_providers_imdb;
  "workflows/steps/categorization/providers/index": typeof workflows_steps_categorization_providers_index;
  "workflows/steps/classification": typeof workflows_steps_classification;
  "workflows/steps/classificationMutations": typeof workflows_steps_classificationMutations;
  "workflows/steps/linkMetadata/fetchMetadata": typeof workflows_steps_linkMetadata_fetchMetadata;
  "workflows/steps/linkMetadata/retryable": typeof workflows_steps_linkMetadata_retryable;
  "workflows/steps/metadata": typeof workflows_steps_metadata;
  "workflows/steps/palette": typeof workflows_steps_palette;
  "workflows/steps/renderables": typeof workflows_steps_renderables;
  "workflows/steps/renderables/generatePdfThumbnail": typeof workflows_steps_renderables_generatePdfThumbnail;
  "workflows/steps/renderables/generateSvgThumbnail": typeof workflows_steps_renderables_generateSvgThumbnail;
  "workflows/steps/renderables/generateThumbnail": typeof workflows_steps_renderables_generateThumbnail;
  "workflows/steps/renderables/generateVideoThumbnail": typeof workflows_steps_renderables_generateVideoThumbnail;
  "workflows/steps/renderables/mutations": typeof workflows_steps_renderables_mutations;
  "workflows/steps/screenshot/captureScreenshot": typeof workflows_steps_screenshot_captureScreenshot;
  "workflows/steps/screenshot/retryable": typeof workflows_steps_screenshot_retryable;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  polar: import("@convex-dev/polar/_generated/component.js").ComponentApi<"polar">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  ratelimiter: import("@convex-dev/ratelimiter/_generated/component.js").ComponentApi<"ratelimiter">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  apiKeys: import("@vllnt/convex-api-keys/_generated/component.js").ComponentApi<"apiKeys">;
};
