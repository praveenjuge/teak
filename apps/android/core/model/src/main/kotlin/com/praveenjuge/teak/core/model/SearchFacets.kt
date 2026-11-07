package com.praveenjuge.teak.core.model

/**
 * The words of a search that name a visual style ("minimal"), a color ("blue") or a hex color ("#3B82F6"),
 * which search as filters rather than text, as on the web and Apple. [text] is what's left to search.
 */
data class SearchFacets(
    val text: String,
    val hues: List<String> = emptyList(),
    val styles: List<String> = emptyList(),
    val hexes: List<String> = emptyList(),
) {
    enum class Kind { Style, Hue, Hex, Keyword }

    data class Token(val kind: Kind, val value: String)

    companion object {
        private val SPACES_OR_UNDERSCORES = Regex("[\\s_]+")
        private val NOT_FACET = Regex("[^a-z0-9-]")
        private val DASHES = Regex("-+")
        private val HEX_DIGITS = Regex("^[0-9a-fA-F]+$")
        private val BARE_HEX = Regex("^[0-9a-fA-F]{6}$")
        private val WORD = Regex("\\S+")
        private val QUOTES = setOf('"', '“', '”')

        /** A word less the punctuation around it, as `normalizeSearchToken` trims it. */
        fun normalizeToken(token: String): String =
            token.trim().trim { it in SEARCH_TOKEN_TRIM_CHARACTERS }

        private fun facetWord(value: String): String =
            value.trim().lowercase().replace(SPACES_OR_UNDERSCORES, "-").replace(NOT_FACET, "").replace(DASHES, "-")

        fun style(value: String): String? {
            val word = facetWord(value).ifEmpty { return null }
            return if (word in VISUAL_STYLES) word else VISUAL_STYLE_ALIASES[word.replace("-", "")]
        }

        fun hue(value: String): String? = facetWord(value).replace("-", "").ifEmpty { null }?.let(COLOR_HUE_ALIASES::get)

        /** "#RGB", "#RGBA", "#RRGGBB" or "#RRGGBBAA" as "#RRGGBB", as `normalizeHexColor` reads a search word. */
        fun hex(value: String): String? {
            val digits = value.trim().removePrefix("#")
            if (!HEX_DIGITS.matches(digits)) return null
            val rgb = when (digits.length) {
                3, 4 -> digits.take(3).map { "$it$it" }.joinToString("")
                6, 8 -> digits.take(6)
                else -> return null
            }
            return "#${rgb.uppercase()}"
        }

        /** Port of `classifySearchToken` (`packages/convex/shared/search/tokenization.ts`). */
        fun classify(raw: String): Token? {
            val token = normalizeToken(raw).ifEmpty { return null }
            style(token)?.let { return Token(Kind.Style, it) }
            hue(token)?.let { return Token(Kind.Hue, it) }
            val hex = if (token.startsWith("#") || BARE_HEX.matches(token)) hex(token) else null
            if (hex != null) return Token(Kind.Hex, hex)
            return Token(Kind.Keyword, token.lowercase())
        }

        /** Whether a quote is still open after [word], skipping `\"` and `\\` inside quotes as `SearchQuery.tokenize` does. */
        private fun quotesOpenAfter(word: String, openBefore: Boolean): Boolean {
            var open = openBefore
            var index = 0
            while (index < word.length) {
                val character = word[index]
                val next = word.getOrNull(index + 1)
                if (open && character == '\\' && next != null && (next in QUOTES || next == '\\')) {
                    index += 2
                    continue
                }
                if (character in QUOTES) open = !open
                index += 1
            }
            return open
        }

        /**
         * Lifts the plain words that [classify] reads as a style, color or hex out of [search]. Words in
         * quotes, qualifiers and searches with operators stay as typed, and so does the spacing of what's left.
         */
        fun split(search: String): SearchFacets {
            val trimmed = search.trim()
            if (trimmed.isEmpty() || SearchQuery.hasOperators(trimmed)) return SearchFacets(trimmed)
            val terms = SearchQuery.parse(trimmed).terms.toSet()
            val lifted = mutableListOf<IntRange>()
            val hues = mutableListOf<String>()
            val styles = mutableListOf<String>()
            val hexes = mutableListOf<String>()
            var inQuotes = false
            for (match in WORD.findAll(trimmed)) {
                val word = match.value
                val quoted = inQuotes || word.any { it in QUOTES }
                inQuotes = quotesOpenAfter(word, inQuotes)
                val token = if (!quoted && word in terms) classify(word) else null
                val bucket = when (token?.kind) {
                    Kind.Style -> styles
                    Kind.Hue -> hues
                    Kind.Hex -> hexes
                    else -> null
                } ?: continue
                lifted += match.range
                if (token!!.value !in bucket) bucket += token.value
            }
            return SearchFacets(withoutRanges(trimmed, lifted), hues, styles, hexes)
        }

        /** [text] less each range and the spaces after it, so what's left keeps its own spacing. */
        private fun withoutRanges(text: String, ranges: List<IntRange>): String {
            if (ranges.isEmpty()) return text
            val kept = StringBuilder()
            var cursor = 0
            for (range in ranges) {
                kept.append(text, cursor, range.first)
                cursor = range.last + 1
                while (cursor < text.length && text[cursor].isWhitespace()) cursor += 1
            }
            kept.append(text, cursor, text.length)
            return kept.toString().trimEnd()
        }
    }
}
