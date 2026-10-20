package com.praveenjuge.teak.core.model

import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
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

enum class SearchIsValue(val wire: String) { Favorite("fav"), Archived("archived"), Done("done"), Todo("todo") }

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
    private val PRICE_BOUND = Regex("^(<=|>=|<|>|=)(\\d{1,12}(?:\\.\\d{1,6})?)$")
    private val WHITESPACE = Regex("\\s+")

    private data class RawToken(val prefix: String, val quoted: Boolean, val text: String)

    private fun tokenize(input: String): List<RawToken> {
        val tokens = mutableListOf<RawToken>()
        var index = 0
        while (index < input.length) {
            while (index < input.length && input[index].isWhitespace()) index += 1
            if (index >= input.length) break
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
            tokens += RawToken(prefix.orEmpty(), prefix != null, text.toString())
        }
        return tokens
    }

    private fun trimEdgePunctuation(value: String, keep: String = ""): String {
        fun trims(character: Char) = character in SEARCH_TOKEN_TRIM_CHARACTERS && character !in keep
        var start = 0
        var end = value.length
        while (start < end && trims(value[start])) start += 1
        while (end > start && trims(value[end - 1])) end -= 1
        return value.substring(start, end)
    }

    private fun parseType(value: String): CardType? {
        val word = value.trim().lowercase()
        if (word in CARD_TYPES) return CardType.entries.first { it.wireName == word }
        if (word.endsWith("s") && word.dropLast(1) in CARD_TYPES) return CardType.entries.first { it.wireName == word.dropLast(1) }
        return null
    }

    fun parsePriceBound(value: String): PriceBound? {
        val match = PRICE_BOUND.matchEntire(value.trim()) ?: return null
        val amount = match.groupValues[2].toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
        return PriceBound(PriceComparison.of(match.groupValues[1]), amount)
    }

    fun formatPriceBound(bound: PriceBound): String = "${bound.op.symbol}${jsNumber(bound.amount)}"

    fun describePriceBound(bound: PriceBound): String {
        val format = DecimalFormat("#,##0.######", DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_UP }
        val amount = format.format(bound.amount)
        return when (bound.op) {
            PriceComparison.Less -> "Under $amount"
            PriceComparison.Greater -> "Over $amount"
            PriceComparison.AtMost -> "$amount or less"
            PriceComparison.AtLeast -> "$amount or more"
            PriceComparison.Equal -> "Exactly $amount"
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
data class QualifierChip(val qualifier: SearchQualifier, val title: String, val label: String) {
    val removeLabel: String get() = "Remove ${title.lowercase()} $label"
}

object QualifierChips {
    /** The chips for every filter in [search], as the web's `describeQualifierChip` words them. */
    fun of(search: String, anchorTitle: String? = null): List<QualifierChip> =
        SearchQuery.parse(search).qualifiers.mapNotNull { describe(it, anchorTitle) }

    fun describe(qualifier: SearchQualifier, anchorTitle: String? = null): QualifierChip? = when (qualifier) {
        is SearchQualifier.Tag -> QualifierChip(qualifier, "Tag", qualifier.value)
        is SearchQualifier.Type -> QualifierChip(qualifier, "Type", qualifier.type.label)
        is SearchQualifier.Is -> QualifierChip(
            qualifier,
            "Show",
            when (qualifier.state) {
                SearchIsValue.Favorite -> "Favorites"
                SearchIsValue.Archived -> "Archived"
                SearchIsValue.Done -> "Done"
                SearchIsValue.Todo -> "To do"
            },
        )
        is SearchQualifier.Site -> QualifierChip(qualifier, "Site", UrlHost.forDisplay(qualifier.value))
        is SearchQualifier.Folder -> QualifierChip(qualifier, "Folder", qualifier.value)
        is SearchQualifier.Like -> QualifierChip(qualifier, "Similar to", anchorTitle ?: "a card")
        is SearchQualifier.Mood -> QualifierChip(qualifier, "Mood", "“${qualifier.value}”")
        is SearchQualifier.Price -> SearchQuery.parsePriceBound(qualifier.value)
            ?.let { QualifierChip(qualifier, "Price", SearchQuery.describePriceBound(it)) }
        is SearchQualifier.Text -> QualifierChip(qualifier, "Text in image", qualifier.value)
    }

    /** [search] without [qualifier], in canonical form. */
    fun remove(search: String, qualifier: SearchQualifier): String {
        val parsed = SearchQuery.parse(search)
        return (
            parsed.qualifiers.filterNot { it == qualifier }.map(SearchQuery::format) +
                parsed.phrases.map(SearchQuery::quote) + parsed.terms
            ).joinToString(" ")
    }

    /** The search with [qualifier] added once, ahead of the words already typed. */
    fun add(search: String, qualifier: SearchQualifier): String {
        val parsed = SearchQuery.parse(search)
        if (qualifier in parsed.qualifiers) return parsed.canonical
        return SearchQuery.parse((listOf(SearchQuery.format(qualifier)) + parsed.canonical).joinToString(" ").trim()).canonical
    }
}
