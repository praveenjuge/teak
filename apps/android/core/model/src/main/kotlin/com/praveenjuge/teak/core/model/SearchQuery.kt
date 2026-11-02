package com.praveenjuge.teak.core.model

import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.ZonedDateTime
import java.util.Locale

/** A port of `packages/convex/shared/search/qualifiers.ts` and `semantic.ts`; keep them in step. */
enum class PriceComparison(val symbol: String) {
    Less("<"),
    Greater(">"),
    AtMost("<="),
    AtLeast(">="),
    Equal("="),
    ;

    companion object {
        fun of(symbol: String): PriceComparison = entries.first { it.symbol == symbol }
    }
}

data class PriceBound(val op: PriceComparison, val amount: Double)

enum class SearchIsValue(val wire: String) { Favorite("fav"), Archived("archived"), Done("done"), Todo("todo"), Pinned("pinned") }

sealed interface SearchQualifier {
    val key: String
    val value: String

    data class Tag(override val value: String) : SearchQualifier { override val key = "tag" }
    data class Type(val type: CardType) : SearchQualifier {
        override val key = "type"
        override val value: String get() = type.wireName
    }
    data class Is(val state: SearchIsValue) : SearchQualifier {
        override val key = "is"
        override val value: String get() = state.wire
    }
    data class Site(override val value: String) : SearchQualifier { override val key = "site" }
    data class Folder(override val value: String) : SearchQualifier { override val key = "folder" }
    data class Like(override val value: String) : SearchQualifier { override val key = "like" }
    data class Mood(override val value: String) : SearchQualifier { override val key = "mood" }
    data class Price(override val value: String) : SearchQualifier { override val key = "price" }
    data class Text(override val value: String) : SearchQualifier { override val key = "text" }
}

sealed interface SearchSimilarity {
    data class Like(val cardId: String) : SearchSimilarity
    data class Mood(val text: String) : SearchSimilarity
}

data class ParsedSearchQuery(
    val qualifiers: List<SearchQualifier>,
    val terms: List<String>,
    val phrases: List<String>,
    val text: String,
    val tags: List<String>,
    val ocrTexts: List<String>,
    val types: List<CardType>,
    val favorite: Boolean,
    val archived: Boolean,
    val done: Boolean,
    val todo: Boolean,
    val sites: List<String>,
    val folders: List<String>,
    val similarity: SearchSimilarity?,
    val prices: List<PriceBound>,
    val canonical: String,
)

sealed interface SemanticRequest {
    val cacheText: String

    data class Text(val text: String) : SemanticRequest { override val cacheText get() = text }
    data class Like(val cardId: String) : SemanticRequest { override val cacheText get() = "like\n$cardId" }
    data class Mood(val text: String) : SemanticRequest { override val cacheText get() = "mood\n$text" }
}

object SearchQuery {
    private const val MAX_MOOD_LENGTH = 200
    private const val MAX_OCR_TEXT_LENGTH = 200
    private const val SEMANTIC_QUERY_MIN_CHARS = 2
    private val CONVEX_ID = Regex("^[0-9a-z]{31,37}$")
    private val QUOTES = setOf('"', '“', '”')
    private val FAVORITE_WORDS = setOf("fav", "favs", "favorite", "favorites", "favourite", "favourites", "starred")
    private val ARCHIVED_WORDS = setOf("archived", "archive")
    private val DONE_WORDS = setOf("done", "completed", "finished")
    private val TODO_WORDS = setOf("todo", "to-do")
    private val PINNED_WORDS = setOf("pinned", "pin", "pins")
    private val PRICE_BOUND = Regex("^(<=|>=|<|>|=)(\\d{1,12}(?:\\.\\d{1,6})?)$")
    private val WHITESPACE = Regex("\\s+")

    /** [source] is the token as it was typed, quotes and escapes included. */
    private data class RawToken(val prefix: String, val quoted: Boolean, val text: String, val source: String = "")

    private fun tokenize(input: String): List<RawToken> {
        val tokens = mutableListOf<RawToken>()
        var index = 0
        while (index < input.length) {
            while (index < input.length && input[index].isWhitespace()) index += 1
            if (index >= input.length) break
            val start = index
            val text = StringBuilder()
            var prefix: String? = null
            var inQuotes = false
            while (index < input.length) {
                val character = input[index]
                if (inQuotes) {
                    val next = input.getOrNull(index + 1)
                    if (character == '\\' && next != null && (next in QUOTES || next == '\\')) {
                        text.append(next)
                        index += 2
                        continue
                    }
                    if (character in QUOTES) {
                        inQuotes = false
                        index += 1
                        continue
                    }
                    text.append(character)
                    index += 1
                    continue
                }
                if (character.isWhitespace()) break
                if (character in QUOTES) {
                    if (prefix == null) prefix = text.toString()
                    inQuotes = true
                    index += 1
                    continue
                }
                text.append(character)
                index += 1
            }
            tokens += RawToken(prefix.orEmpty(), prefix != null, text.toString(), input.substring(start, index))
        }
        return tokens
    }

    /**
     * Whether the text uses search operators: a word that starts with `-`, an uppercase `OR` or a
     * parenthesis, outside quotes. Such text is sent as typed, since lifting a filter out of it could
     * change what it means. Apple's `SearchQualifiers.hasOperators` is the same rule.
     */
    fun hasOperators(text: String): Boolean {
        var inQuotes = false
        var escaped = false
        var word = ""
        for (character in text) {
            if (inQuotes) {
                when {
                    escaped -> escaped = false
                    character == '\\' -> escaped = true
                    character in QUOTES -> inQuotes = false
                }
                continue
            }
            when {
                character in QUOTES -> {
                    if (word == "-") return true
                    inQuotes = true
                    word += '"'
                }
                character == '(' || character == ')' -> return true
                character.isWhitespace() -> {
                    if (word == "OR") return true
                    word = ""
                }
                word.isEmpty() && character == '-' -> word = "-"
                word == "-" -> return true
                else -> word += character
            }
        }
        return word == "OR"
    }

    private val TYPED_OR = Regex("(^|[\\s(])OR(?=[\\s)]|$)")

    /**
     * Search parts joined by spaces, each part with an `OR` in parentheses when there are others,
     * since a space binds tighter than `OR`: the grouping the web's `buildCardsSearchTerms` applies.
     */
    fun join(parts: List<String>): String {
        val kept = parts.map(String::trim).filter(String::isNotEmpty)
        if (kept.size <= 1) return kept.firstOrNull().orEmpty()
        return kept.joinToString(" ") { if (TYPED_OR.containsMatchIn(it)) "($it)" else it }
    }

    /** The text before the word being typed at the end, and that word, as the web's `currentSearchToken` finds them. */
    fun currentWord(text: String): Pair<String, String> {
        var start = 0
        var inQuotes = false
        var index = 0
        while (index < text.length) {
            val character = text[index]
            if (character == '\\' && inQuotes) {
                index += 2
                continue
            }
            if (character in QUOTES) {
                inQuotes = !inQuotes
            } else if (!inQuotes && character.isWhitespace()) {
                start = index + 1
            }
            index += 1
        }
        return text.substring(0, start.coerceAtMost(text.length)) to text.substring(start.coerceAtMost(text.length))
    }

    data class DateSplit(val filter: TimeFilter, val rest: String)

    /**
     * A date written inside typed text: "figma last week" searches "figma" from last week. A lone number
     * isn't read as a year beside other words, and text with operators is left whole. Apple's
     * `SearchTokens.splitDate` is the same rule.
     */
    fun splitDate(text: String, now: ZonedDateTime = ZonedDateTime.now(), locale: Locale = Locale.getDefault()): DateSplit? {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || hasOperators(trimmed)) return null
        TimeSearch.parse(trimmed, now, locale)?.let { return DateSplit(it, "") }
        val raws = tokenize(trimmed)
        for (start in raws.indices) {
            for (length in minOf(9, raws.size - start) downTo 1) {
                val slice = raws.subList(start, start + length)
                if (slice.any { it.quoted }) continue
                val phrase = slice.joinToString(" ") { it.text.trim { c -> c in DATE_PUNCTUATION } }
                if (length == 1 && (':' in phrase || phrase.all(Char::isDigit))) continue
                val filter = TimeSearch.parse(phrase, now, locale) ?: continue
                val rest = (raws.subList(0, start) + raws.subList(start + length, raws.size)).joinToString(" ") { it.source }
                return DateSplit(filter, rest)
            }
        }
        return null
    }

    private const val DATE_PUNCTUATION = ",.;:!?()[]{}\"'"

    private fun trimEdgePunctuation(value: String, keep: String = ""): String {
        fun trims(character: Char) = character in SEARCH_TOKEN_TRIM_CHARACTERS && character !in keep
        var start = 0
        var end = value.length
        while (start < end && trims(value[start])) start += 1
        while (end > start && trims(value[end - 1])) end -= 1
        return value.substring(start, end)
    }

    // Everyday words for each card type, as on the web (CARD_TYPE_ALIASES in
    // packages/convex/shared/search/qualifiers.ts). Each also works with an `s`.
    private val CARD_TYPE_ALIASES: Map<String, CardType> = mapOf(
        "bookmark" to CardType.Link,
        "clip" to CardType.Video,
        "color" to CardType.Palette,
        "colour" to CardType.Palette,
        "doc" to CardType.Document,
        "memo" to CardType.Audio,
        "movie" to CardType.Video,
        "note" to CardType.Text,
        "pdf" to CardType.Document,
        "photo" to CardType.Image,
        "pic" to CardType.Image,
        "picture" to CardType.Image,
        "recording" to CardType.Audio,
        "url" to CardType.Link,
        "voice" to CardType.Audio,
        "website" to CardType.Link,
    )

    private fun typeForWord(word: String): CardType? =
        if (word in CARD_TYPES) CardType.entries.first { it.wireName == word } else CARD_TYPE_ALIASES[word]

    private fun parseType(value: String): CardType? {
        val word = value.trim().lowercase()
        return typeForWord(word) ?: if (word.endsWith("s")) typeForWord(word.dropLast(1)) else null
    }

    fun parsePriceBound(value: String): PriceBound? {
        val match = PRICE_BOUND.matchEntire(value.trim()) ?: return null
        val amount = match.groupValues[2].toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
        return PriceBound(PriceComparison.of(match.groupValues[1]), amount)
    }

    fun formatPriceBound(bound: PriceBound): String = "${bound.op.symbol}${jsNumber(bound.amount)}"

    /** A price filter in the app's language, "Under 50", with the amount written the [locale]'s way. */
    fun describePriceBoundText(bound: PriceBound, locale: Locale = Locale.getDefault()): UiText {
        val format = DecimalFormat("#,##0.######", DecimalFormatSymbols(locale)).apply { roundingMode = RoundingMode.HALF_UP }
        val amount = format.format(bound.amount)
        return when (bound.op) {
            PriceComparison.Less -> UiText.of("native.filters.price.under", amount)
            PriceComparison.Greater -> UiText.of("native.filters.price.over", amount)
            PriceComparison.AtMost -> UiText.of("native.filters.price.atMost", amount)
            PriceComparison.AtLeast -> UiText.of("native.filters.price.atLeast", amount)
            PriceComparison.Equal -> UiText.of("native.filters.price.exactly", amount)
        }
    }

    private fun parseQualifier(key: String, rawValue: String): SearchQualifier? {
        val value = rawValue.trim()
        if (value.isEmpty()) return null
        return when (key) {
            "tag" -> Tags.key(value).takeIf { it.isNotEmpty() && it.length <= MAX_TAG_KEY_LENGTH }?.let(SearchQualifier::Tag)
            "type" -> parseType(value)?.let(SearchQualifier::Type)
            "is" -> {
                val word = value.lowercase()
                when (word) {
                    in FAVORITE_WORDS -> SearchQualifier.Is(SearchIsValue.Favorite)
                    in DONE_WORDS -> SearchQualifier.Is(SearchIsValue.Done)
                    in TODO_WORDS -> SearchQualifier.Is(SearchIsValue.Todo)
                    in PINNED_WORDS -> SearchQualifier.Is(SearchIsValue.Pinned)
                    in ARCHIVED_WORDS -> SearchQualifier.Is(SearchIsValue.Archived)
                    else -> null
                }
            }
            "site" -> UrlHost.normalize(value)?.let(SearchQualifier::Site)
            "folder" -> SearchQualifier.Folder(value)
            "like" -> if (CONVEX_ID.matches(value)) SearchQualifier.Like(value) else null
            "mood" -> value.replace(WHITESPACE, " ").take(MAX_MOOD_LENGTH).trim().takeIf { it.isNotEmpty() }?.let(SearchQualifier::Mood)
            "price" -> parsePriceBound(value)?.let { SearchQualifier.Price(formatPriceBound(it)) }
            "text" -> value.replace(WHITESPACE, " ").take(MAX_OCR_TEXT_LENGTH).trim().takeIf { it.isNotEmpty() }?.let(SearchQualifier::Text)
            else -> null
        }
    }

    private fun isSimilarity(qualifier: SearchQualifier) = qualifier is SearchQualifier.Like || qualifier is SearchQualifier.Mood

    private fun identity(qualifier: SearchQualifier): String {
        val value = when (qualifier) {
            is SearchQualifier.Folder, is SearchQualifier.Mood, is SearchQualifier.Text -> qualifier.value.lowercase()
            else -> qualifier.value
        }
        return "${qualifier.key}:$value"
    }

    private fun identity(similarity: SearchSimilarity): String = when (similarity) {
        is SearchSimilarity.Like -> identity(SearchQualifier.Like(similarity.cardId))
        is SearchSimilarity.Mood -> identity(SearchQualifier.Mood(similarity.text))
    }

    private fun needsQuotes(value: String): Boolean =
        value.any { it.isWhitespace() || it in QUOTES || it == '\\' } ||
            (value.firstOrNull()?.let { it in SEARCH_TOKEN_TRIM_CHARACTERS } ?: false) ||
            (value.lastOrNull()?.let { it in SEARCH_TOKEN_TRIM_CHARACTERS } ?: false)

    fun quote(value: String): String = buildString {
        append('"')
        for (character in value) {
            if (character == '\\' || character in QUOTES) append('\\')
            append(character)
        }
        append('"')
    }

    fun format(qualifier: SearchQualifier): String {
        val value = if (qualifier is SearchQualifier.Site) UrlHost.forDisplay(qualifier.value) else qualifier.value
        return "${qualifier.key}:${if (needsQuotes(value)) quote(value) else value}"
    }

    fun parse(input: String): ParsedSearchQuery {
        val qualifiers = mutableListOf<SearchQualifier>()
        val seen = HashSet<String>()
        val terms = mutableListOf<String>()
        val phrases = mutableListOf<String>()
        fun add(qualifier: SearchQualifier) {
            if (seen.add(identity(qualifier))) qualifiers += qualifier
        }

        for (token in tokenize(input)) {
            val colon = if (token.quoted) token.prefix.indexOf(':') else token.text.indexOf(':')
            val keyCandidate = if (colon > 0) token.text.substring(0, colon).lowercase() else ""
            if (colon > 0 && (!token.quoted || colon == token.prefix.length - 1) && keyCandidate in SEARCH_QUALIFIER_KEYS) {
                val rawValue = token.text.substring(colon + 1)
                val qualifier = parseQualifier(
                    keyCandidate,
                    if (token.quoted) rawValue else trimEdgePunctuation(rawValue, if (keyCandidate == "site") "[]" else ""),
                )
                when {
                    qualifier != null && isSimilarity(qualifier) &&
                        qualifiers.any { isSimilarity(it) && identity(it) != identity(qualifier) } -> terms += token.text
                    qualifier != null -> add(qualifier)
                    rawValue.isNotBlank() -> terms += token.text
                }
                continue
            }

            if (token.text.startsWith("#") && (!token.quoted || token.prefix == "#")) {
                val value = if (token.quoted) token.text.substring(1) else trimEdgePunctuation(token.text.substring(1))
                if (!token.quoted && value.isNotEmpty() && ColorText.isColor("#$value")) {
                    terms += token.text
                    continue
                }
                parseQualifier("tag", value)?.let(::add)
                continue
            }

            if (token.quoted && token.prefix.isEmpty()) {
                token.text.trim().takeIf { it.isNotEmpty() }?.let { phrases += it }
                continue
            }

            if (token.text.isNotBlank()) terms += token.text
        }

        var similarity: SearchSimilarity? = null
        val states = HashSet<SearchIsValue>()
        for (qualifier in qualifiers) {
            when (qualifier) {
                is SearchQualifier.Like -> similarity = SearchSimilarity.Like(qualifier.value)
                is SearchQualifier.Mood -> similarity = SearchSimilarity.Mood(qualifier.value)
                is SearchQualifier.Is -> states += qualifier.state
                else -> Unit
            }
        }
        val canonical = (qualifiers.map(::format) + phrases.map(::quote) + terms).joinToString(" ")
        return ParsedSearchQuery(
            qualifiers = qualifiers,
            terms = terms,
            phrases = phrases,
            text = (terms + phrases).joinToString(" ").trim(),
            tags = qualifiers.filterIsInstance<SearchQualifier.Tag>().map { it.value },
            ocrTexts = qualifiers.filterIsInstance<SearchQualifier.Text>().map { it.value },
            types = qualifiers.filterIsInstance<SearchQualifier.Type>().map { it.type },
            favorite = SearchIsValue.Favorite in states,
            archived = SearchIsValue.Archived in states,
            done = SearchIsValue.Done in states,
            todo = SearchIsValue.Todo in states,
            sites = qualifiers.filterIsInstance<SearchQualifier.Site>().map { it.value },
            folders = qualifiers.filterIsInstance<SearchQualifier.Folder>().map { it.value.trim().lowercase() },
            similarity = similarity,
            prices = qualifiers.filterIsInstance<SearchQualifier.Price>().mapNotNull { parsePriceBound(it.value) },
            canonical = canonical,
        )
    }

    /** A smart folder's search and the words typed inside it, as one search; null when both can't match. */
    fun combine(scope: String, typed: String): String? {
        val outer = parse(scope)
        val inner = parse(typed)
        val outerSimilarity = outer.similarity
        val innerSimilarity = inner.similarity
        if (outerSimilarity != null && innerSimilarity != null && identity(outerSimilarity) != identity(innerSimilarity)) return null
        fun <T> intersect(left: List<T>, right: List<T>): List<T> = when {
            left.isEmpty() -> right
            right.isEmpty() -> left
            else -> left.filter { it in right }
        }
        val types = intersect(outer.types, inner.types)
        val sites = intersect(outer.sites, inner.sites)
        if ((outer.types.isNotEmpty() && inner.types.isNotEmpty() && types.isEmpty()) ||
            (outer.sites.isNotEmpty() && inner.sites.isNotEmpty() && sites.isEmpty())
        ) {
            return null
        }
        fun narrowed(qualifier: SearchQualifier) = qualifier is SearchQualifier.Type || qualifier is SearchQualifier.Site
        val qualifiers = outer.qualifiers.filterNot(::narrowed) + inner.qualifiers.filterNot(::narrowed) +
            types.map(SearchQualifier::Type) + sites.map(SearchQualifier::Site)
        return parse(
            (qualifiers.map(::format) + (outer.phrases + inner.phrases).map(::quote) + outer.terms + inner.terms).joinToString(" "),
        ).canonical
    }

    fun semanticText(parsed: ParsedSearchQuery): String {
        val words = parsed.terms.filterNot { it.startsWith("#") && ColorText.isColor(it) }
        val text = (words + parsed.phrases).joinToString(" ").replace(WHITESPACE, " ").trim().lowercase()
            .take(SEMANTIC_QUERY_MAX_CHARS).trim()
        return if (text.length >= SEMANTIC_QUERY_MIN_CHARS) text else ""
    }

    fun semanticRequest(parsed: ParsedSearchQuery): SemanticRequest? = when (val similarity = parsed.similarity) {
        is SearchSimilarity.Like -> SemanticRequest.Like(similarity.cardId)
        is SearchSimilarity.Mood -> SemanticRequest.Mood(similarity.text.replace(WHITESPACE, " ").trim().lowercase().take(SEMANTIC_QUERY_MAX_CHARS))
        null -> semanticText(parsed).takeIf { it.isNotEmpty() }?.let(SemanticRequest::Text)
    }

    /** Writes a number the way JavaScript's `String(number)` does for the amounts a price bound holds. */
    internal fun jsNumber(value: Double): String =
        if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toBigDecimal().stripTrailingZeros().toPlainString()
}

/** Whether text reads as a color, as `normalizeHexColor` decides in `packages/convex/shared/utils/colorUtils.ts`. */
object ColorText {
    private val HEX = Regex("^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$", RegexOption.IGNORE_CASE)
    private val RGB = Regex("rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*[\\d.]+\\s*)?\\)")
    private val HSL = Regex("hsla?\\(\\s*(\\d+)\\s*,\\s*(\\d+)%\\s*,\\s*(\\d+)%\\s*(?:,\\s*[\\d.]+\\s*)?\\)")
    private val NON_LETTERS = Regex("[^a-z]")

    fun isColor(value: String): Boolean {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return false
        val text = (if (trimmed.startsWith("#")) trimmed else "#$trimmed").trim().lowercase()
        if (HEX.matches(text)) return true
        RGB.find(text)?.let { match ->
            if (match.groupValues.drop(1).all { (it.toIntOrNull() ?: 256) in 0..255 }) return true
        }
        HSL.find(text)?.let { match ->
            val (h, s, l) = match.groupValues.drop(1).map { it.toIntOrNull() ?: -1 }
            if (h in 0..360 && s in 0..100 && l in 0..100) return true
        }
        return text.replace(NON_LETTERS, "") in CSS_COLOR_NAMES
    }

    private val CSS_COLOR_NAMES = (
        "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
            "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
            "darkgoldenrod darkgray darkgrey darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
            "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
            "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold " +
            "goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
            "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen " +
            "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow " +
            "lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
            "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
            "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
            "palevioletred papayawhip peachpuff peru pink plum powderblue purple red rosybrown royalblue saddlebrown " +
            "salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
            "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
        ).split(' ').toSet()
}

/** A filter written in the search, shown as a removable chip: "Show · Archived", "Price · Under 50". */
data class QualifierChip(
    val qualifier: SearchQualifier,
    /** What the filter is, "Show", in the app's language. */
    val titleText: UiText,
    /** Its value, "Archived": the app's words for Teak's own values, else the value as it was typed. */
    val labelText: UiText,
) {
    /** The remove button's spoken label: "Remove tag design". */
    val removeText: UiText
        get() = when (qualifier) {
            is SearchQualifier.Tag -> UiText.of("native.filters.removeChip.tag", labelText)
            is SearchQualifier.Type -> UiText.of("native.filters.removeChip.type", labelText)
            is SearchQualifier.Is -> UiText.of("native.filters.removeChip.is", labelText)
            is SearchQualifier.Site -> UiText.of("native.filters.removeChip.site", labelText)
            is SearchQualifier.Folder -> UiText.of("native.filters.removeChip.folder", labelText)
            is SearchQualifier.Like -> UiText.of("native.filters.removeChip.like", labelText)
            is SearchQualifier.Mood -> UiText.of("native.filters.removeChip.mood", labelText)
            is SearchQualifier.Price -> UiText.of("native.filters.removeChip.price", labelText)
            is SearchQualifier.Text -> UiText.of("native.filters.removeChip.text", labelText)
        }
}

object QualifierChips {
    private val WHITESPACE = Regex("\\s+")

    /**
     * The chips for every filter in [search], as the web's `describeQualifierChip` words them. A search
     * with `-`, `OR` or parentheses shows none: its filters may sit inside a group, and removing one
     * from there would change the rest.
     */
    fun of(search: String, anchorTitle: String? = null): List<QualifierChip> =
        if (SearchQuery.hasOperators(search)) {
            emptyList()
        } else {
            SearchQuery.parse(search).qualifiers.mapNotNull { describe(it, anchorTitle) }
        }

    private fun isText(value: SearchIsValue): UiText = when (value) {
        SearchIsValue.Favorite -> UiText.of("native.filters.is.fav")
        SearchIsValue.Archived -> UiText.of("native.filters.is.archived")
        SearchIsValue.Done -> UiText.of("native.filters.is.done")
        SearchIsValue.Todo -> UiText.of("native.filters.is.todo")
        SearchIsValue.Pinned -> UiText.of("native.filters.is.pinned")
    }

    fun describe(qualifier: SearchQualifier, anchorTitle: String? = null): QualifierChip? = when (qualifier) {
        is SearchQualifier.Tag -> QualifierChip(qualifier, UiText.of("native.filters.chips.tag"), UiText.verbatim(qualifier.value))
        is SearchQualifier.Type -> QualifierChip(qualifier, UiText.of("native.filters.chips.type"), qualifier.type.labelText)
        is SearchQualifier.Is -> QualifierChip(qualifier, UiText.of("native.filters.chips.is"), isText(qualifier.state))
        is SearchQualifier.Site -> QualifierChip(
            qualifier, UiText.of("native.filters.chips.site"), UiText.verbatim(UrlHost.forDisplay(qualifier.value)),
        )
        is SearchQualifier.Folder -> QualifierChip(qualifier, UiText.of("native.filters.chips.folder"), UiText.verbatim(qualifier.value))
        is SearchQualifier.Like -> QualifierChip(
            qualifier,
            UiText.of("native.filters.chips.like"),
            anchorTitle?.let(UiText::verbatim) ?: UiText.of("native.filters.chips.anyCard"),
        )
        is SearchQualifier.Mood -> QualifierChip(
            qualifier, UiText.of("native.filters.chips.mood"), UiText.of("native.filters.chips.moodValue", qualifier.value),
        )
        is SearchQualifier.Price -> SearchQuery.parsePriceBound(qualifier.value)?.let {
            QualifierChip(qualifier, UiText.of("native.filters.chips.price"), SearchQuery.describePriceBoundText(it))
        }
        is SearchQualifier.Text -> QualifierChip(qualifier, UiText.of("native.filters.chips.text"), UiText.verbatim(qualifier.value))
    }

    /** [search] without [qualifier], in canonical form; a search with operators keeps the rest as typed. */
    fun remove(search: String, qualifier: SearchQualifier): String {
        if (SearchQuery.hasOperators(search)) {
            return search.trim().split(WHITESPACE).filterNot { word ->
                word.first() !in "-(" && ')' !in word && SearchQuery.parse(word).qualifiers == listOf(qualifier)
            }.joinToString(" ")
        }
        val parsed = SearchQuery.parse(search)
        return (
            parsed.qualifiers.filterNot { it == qualifier }.map(SearchQuery::format) +
                parsed.phrases.map(SearchQuery::quote) + parsed.terms
            ).joinToString(" ")
    }

    /** The search with [qualifier] added once, ahead of the words already typed, which keep their grouping. */
    fun add(search: String, qualifier: SearchQualifier): String {
        if (SearchQuery.hasOperators(search)) {
            val words = search.trim().split(WHITESPACE)
            if (words.any { it.first() !in "-(" && ')' !in it && SearchQuery.parse(it).qualifiers == listOf(qualifier) }) return search
            return SearchQuery.join(listOf(SearchQuery.format(qualifier), search))
        }
        val parsed = SearchQuery.parse(search)
        if (qualifier in parsed.qualifiers) return parsed.canonical
        return SearchQuery.parse((listOf(SearchQuery.format(qualifier)) + parsed.canonical).joinToString(" ").trim()).canonical
    }
}
