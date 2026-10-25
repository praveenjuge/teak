package com.praveenjuge.teak.core.model

const val FREE_TIER_LIMIT = 200

const val MAX_FILE_SIZE: Long = 104857600L

const val MAX_FILES_PER_UPLOAD = 20

const val SIGNUPS_PAUSED_MESSAGE = "New sign-ups are paused right now. Please try again later."

val CARD_TYPES: List<String> = listOf(
    "text",
    "link",
    "image",
    "video",
    "audio",
    "document",
    "palette",
    "quote",
)

val CARD_TYPE_LABELS: Map<String, String> = mapOf(
    "text" to "Text",
    "link" to "Link",
    "image" to "Image",
    "video" to "Video",
    "audio" to "Audio",
    "document" to "Document",
    "palette" to "Palette",
    "quote" to "Quote",
)

val COLOR_HUE_BUCKETS: List<String> = listOf(
    "red",
    "orange",
    "yellow",
    "green",
    "teal",
    "cyan",
    "blue",
    "purple",
    "pink",
    "brown",
    "neutral",
)

val COLOR_HUE_LABELS: Map<String, String> = mapOf(
    "red" to "Red",
    "orange" to "Orange",
    "yellow" to "Yellow",
    "green" to "Green",
    "teal" to "Teal",
    "cyan" to "Cyan",
    "blue" to "Blue",
    "purple" to "Purple",
    "pink" to "Pink",
    "brown" to "Brown",
    "neutral" to "Neutral",
)

const val MAX_TAG_NAME_LENGTH = 64

val TAG_ERROR_MESSAGES: Map<String, String> = mapOf(
    "EMPTY_NAME" to "Name the tag",
    "NAME_TOO_LONG" to "Tags can be at most 64 characters",
    "NOT_FOUND" to "Tag not found",
    "SAME_TAG" to "Choose a different tag to merge into",
    "OPERATION_RUNNING" to "Another tag change is still running",
    "OPERATION_NOT_FOUND" to "Tag operation not found",
)

val HIDDEN_TAG_KEYS: List<String> = listOf(
    "secret",
    "hidden",
)

val LINK_CATEGORY_DONE_VERBS: Map<String, String> = mapOf(
    "book" to "read",
    "movie" to "watched",
    "tv" to "watched",
    "article" to "read",
    "news" to "read",
    "podcast" to "listened",
    "music" to "listened",
    "product" to "bought",
    "recipe" to "cooked",
    "course" to "done",
    "research" to "read",
    "event" to "done",
    "software" to "done",
    "design_portfolio" to "done",
    "place" to "done",
    "typeface" to "done",
    "social_post" to "done",
    "app" to "done",
    "game" to "played",
    "repo" to "done",
    "other" to "done",
)

val ACTIONABLE_LINK_CATEGORIES: List<String> = listOf(
    "app",
    "article",
    "book",
    "course",
    "event",
    "game",
    "movie",
    "music",
    "news",
    "podcast",
    "product",
    "recipe",
    "tv",
)

const val MAX_TAG_KEY_LENGTH = 256

const val MAX_BULK_CARD_IDS = 100

const val MAX_BULK_TAGS = 20

const val SEMANTIC_QUERY_MAX_CHARS = 500

const val CARD_LINK_TITLE_MAX_LENGTH = 200

const val MAX_CARD_LINKS = 500

const val SEARCH_TOKEN_TRIM_CHARACTERS = ",.;:!?()[]{}\"'"

val SEARCH_QUALIFIER_KEYS: List<String> = listOf(
    "tag",
    "type",
    "is",
    "site",
    "folder",
    "like",
    "mood",
    "price",
    "text",
)

/** The search field's hints, from `packages/convex/shared/search/suggestionHints.ts`. */
val SEARCH_QUALIFIER_HINTS: List<SearchHint> = listOf(
    SearchHint(id = "Filters:tag", group = "Filters", key = "tag", insert = "tag:", messageKey = "search.suggestions.hints.tag"),
    SearchHint(id = "Filters:type", group = "Filters", key = "type", insert = "type:", messageKey = "search.suggestions.hints.type"),
    SearchHint(id = "Filters:site", group = "Filters", key = "site", insert = "site:", messageKey = "search.suggestions.hints.site"),
    SearchHint(id = "Filters:folder", group = "Filters", key = "folder", insert = "folder:", messageKey = "search.suggestions.hints.folder"),
    SearchHint(id = "Filters:is", group = "Filters", key = "is", insert = "is:", messageKey = "search.suggestions.hints.is"),
    SearchHint(id = "Filters:mood", group = "Filters", key = "mood", insert = "mood:", messageKey = "search.suggestions.hints.mood"),
    SearchHint(id = "Filters:price", group = "Filters", key = "price", insert = "price:", messageKey = "search.suggestions.hints.price"),
    SearchHint(id = "Filters:text", group = "Filters", key = "text", insert = "text:", messageKey = "search.suggestions.hints.text"),
)

val SEARCH_EXCLUDE_HINTS: List<SearchHint> = listOf(
    SearchHint(id = "Exclude:-tag", group = "Exclude", key = "tag", insert = "-tag:", messageKey = "search.suggestions.excludeHints.tag"),
    SearchHint(id = "Exclude:-type", group = "Exclude", key = "type", insert = "-type:", messageKey = "search.suggestions.excludeHints.type"),
    SearchHint(id = "Exclude:-site", group = "Exclude", key = "site", insert = "-site:", messageKey = "search.suggestions.excludeHints.site"),
    SearchHint(id = "Exclude:-folder", group = "Exclude", key = "folder", insert = "-folder:", messageKey = "search.suggestions.excludeHints.folder"),
    SearchHint(id = "Exclude:-is", group = "Exclude", key = "is", insert = "-is:", messageKey = "search.suggestions.excludeHints.is"),
)

val SEARCH_OR_HINT: SearchHint = SearchHint(id = "Combine:OR", group = "Combine", key = "OR", insert = "OR ", messageKey = "search.suggestions.orDetail")

val SEARCH_IS_OPTIONS: List<SearchIsOption> = listOf(
    SearchIsOption(value = "fav", words = listOf("fav", "favorites", "starred"), messageKey = "search.suggestions.isOptions.fav"),
    SearchIsOption(value = "archived", words = listOf("archived", "archive"), messageKey = "search.suggestions.isOptions.archived"),
    SearchIsOption(value = "done", words = listOf("done", "completed", "finished"), messageKey = "search.suggestions.isOptions.done"),
    SearchIsOption(value = "todo", words = listOf("todo", "to-do"), messageKey = "search.suggestions.isOptions.todo"),
)

val SEARCH_SUGGESTION_GROUPS: Map<String, String> = mapOf(
    "Combine" to "search.suggestions.groups.combine",
    "Exclude" to "search.suggestions.groups.exclude",
    "Filters" to "search.suggestions.groups.filters",
    "Tags" to "search.suggestions.groups.tags",
    "Types" to "search.suggestions.groups.types",
    "Folders" to "search.suggestions.groups.folders",
    "Sites" to "search.suggestions.groups.sites",
    "Show" to "search.suggestions.groups.show",
)

/** Teak's languages, in the order the Language setting lists them, each in its own name. */
val LOCALE_NAMES: Map<String, String> = mapOf(
    "en" to "English",
    "es" to "Español",
    "pt-BR" to "Português (Brasil)",
    "de" to "Deutsch",
    "fr" to "Français",
    "ja" to "日本語",
    "ko" to "한국어",
    "zh-Hans" to "简体中文",
)
