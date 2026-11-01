package com.praveenjuge.teak.core.model

/** A hint from `packages/convex/shared/search/suggestionHints.ts`, generated into `SharedConstants.kt`. */
data class SearchHint(val id: String, val group: String, val key: String, val insert: String, val messageKey: String)

/** An `is:` value, with the words people type for it. */
data class SearchIsOption(val value: String, val words: List<String>, val messageKey: String)

/** A hint the search field offers for the word being typed: a filter to start (`tag:`) or leave out (`-tag:`), `OR`, or a value. */
data class SearchSuggestion(
    val id: String,
    /** The web's group: Filters, Exclude, Combine, Types or Show. */
    val group: String,
    /** What picking it writes in place of the word being typed. */
    val insert: String,
    /** `-tag:`, `OR`, or a value in the app's language. */
    val label: UiText,
    val detail: UiText?,
    /** A whole filter, so a space follows it. */
    val complete: Boolean,
) {
    /** The group's heading, "Exclude" or "Combine". */
    val groupText: UiText get() = SEARCH_SUGGESTION_GROUPS[group]?.let { UiText.of(it) } ?: UiText.verbatim(group)

    /** The search text after picking this suggestion while [text] is typed. */
    fun accept(text: String): String = SearchQuery.currentWord(text).first + insert + if (complete) " " else ""
}

/**
 * A port of the web's `buildSearchSuggestions` (`apps/web/src/components/search/searchSuggestions.ts`), from
 * the shared hint lists. The web also suggests the person's tags, sites and folders; the apps offer the hints,
 * card types and `is:` values. Apple's `SearchSuggestions` is the same port.
 */
object SearchSuggestions {
    private const val GROUP_LIMIT = 8
    private val OR_WORD = Regex("^or?$", RegexOption.IGNORE_CASE)
    private val QUALIFIER = Regex("^(tag|type|is|site|folder):([\\s\\S]*)$", RegexOption.IGNORE_CASE)
    private val QUOTES = "\"“”"

    /** Suggestions for the last word of [text]. */
    fun build(text: String): List<SearchSuggestion> {
        val (before, word) = SearchQuery.currentWord(text)
        return build(word, afterWord = before.isNotBlank())
    }

    private fun build(token: String, afterWord: Boolean): List<SearchSuggestion> {
        if (token.isBlank()) return emptyList()
        if (token.startsWith("-") && !token.startsWith("--")) return excluding(token.drop(1))
        // `OR` joins two words or filters, so it is offered only after one.
        if (afterWord && OR_WORD.matches(token)) return listOf(hint(SEARCH_OR_HINT)) + build(token, afterWord = false)
        if (token.startsWith("#")) return emptyList()
        QUALIFIER.matchEntire(token)?.let { match ->
            val values = valueSuggestions(match.groupValues[1].lowercase(), unquote(match.groupValues[2]))
            val typed = SearchQuery.parse(token).qualifiers.firstOrNull()
            return if (typed != null && values.size == 1 && values[0].insert == SearchQuery.format(typed)) emptyList() else values
        }
        val word = token.lowercase()
        return SEARCH_QUALIFIER_HINTS.filter { it.key.startsWith(word) }.map(::hint)
    }

    /** After a `-`: the filters to leave out, then excluded values. */
    private fun excluding(token: String): List<SearchSuggestion> {
        val word = token.lowercase()
        val keys = if (':' in token || token.startsWith("#")) emptyList() else SEARCH_EXCLUDE_HINTS.filter { it.key.startsWith(word) }.map(::hint)
        val excludable = SEARCH_EXCLUDE_HINTS.map { it.key }.toSet()
        val values = build(token, afterWord = false)
            .filter { it.group != "Filters" && it.insert.substringBefore(':') in excludable }
            .map { it.copy(id = "Exclude:-${it.insert}", group = "Exclude", insert = "-${it.insert}") }
        return keys + values
    }

    private fun valueSuggestions(key: String, value: String): List<SearchSuggestion> {
        val needle = value.trim().lowercase()
        return when (key) {
            "type" -> rank(CARD_TYPES.mapNotNull { wire -> CardType.entries.firstOrNull { it.wireName == wire } }, needle) {
                "${it.wireName} ${CARD_TYPE_LABELS[it.wireName].orEmpty()}"
            }
                .take(GROUP_LIMIT)
                .map { complete(SearchQualifier.Type(it), "Types", it.labelText) }
            "is" -> SEARCH_IS_OPTIONS
                .filter { option -> needle.isEmpty() || option.words.any { it.startsWith(needle) } }
                .mapNotNull { option ->
                    SearchIsValue.entries.firstOrNull { it.wire == option.value }
                        ?.let { complete(SearchQualifier.Is(it), "Show", UiText.of(option.messageKey)) }
                }
            else -> emptyList()
        }
    }

    private fun hint(hint: SearchHint) = SearchSuggestion(
        id = hint.id,
        group = hint.group,
        insert = hint.insert,
        label = UiText.verbatim(hint.insert.trim()),
        detail = UiText.of(hint.messageKey),
        complete = false,
    )

    private fun complete(qualifier: SearchQualifier, group: String, label: UiText): SearchSuggestion {
        val insert = SearchQuery.format(qualifier)
        return SearchSuggestion(id = "$group:$insert", group = group, insert = insert, label = label, detail = null, complete = true)
    }

    /** Exact names, then names that start with the text, then names with a word that does. */
    private fun <T> rank(items: List<T>, needle: String, name: (T) -> String): List<T> {
        if (needle.isEmpty()) return items
        val exact = mutableListOf<T>()
        val starts = mutableListOf<T>()
        val words = mutableListOf<T>()
        for (item in items) {
            val itemName = name(item).lowercase()
            when {
                itemName == needle -> exact += item
                itemName.startsWith(needle) -> starts += item
                itemName.split(' ', '-', '_', '.', '/').any { it.startsWith(needle) } -> words += item
            }
        }
        return exact + starts + words
    }

    private fun unquote(value: String): String {
        var text = value
        if (text.firstOrNull()?.let { it in QUOTES } == true) text = text.drop(1)
        if (text.lastOrNull()?.let { it in QUOTES } == true) text = text.dropLast(1)
        return text
    }
}
