package com.praveenjuge.teak.core.model

data class TextCardInput(val content: String, val type: CardType, val url: String? = null)

/** Port of `resolveTextCardInput` in packages/convex/shared/utils/linkDetection.ts. */
object LinkDetection {
    private val urlOnly = Regex("^https?://\\S+$")
    private val urlInline = Regex("(https?://\\S+)")
    private val markdownEscape = Regex("\\\\([!-/:-@\\[-`{-~])")
    private val htmlEntity = Regex("&(amp|lt|gt);")
    private val entities = mapOf("amp" to "&", "lt" to "<", "gt" to ">")

    private fun unescape(candidate: String): String =
        candidate.replace(markdownEscape, "$1")
            .replace(htmlEntity) { entities[it.groupValues[1]] ?: it.value }

    // WHATWG URL parsing (what the backend uses) accepts characters java.net.URI rejects, such as
    // `|` or `{`, so check only what it requires: an http(s) scheme and a non-empty host.
    private val httpUrl = Regex("^https?://[^/?#\\s]+")

    private fun isHttpUrl(candidate: String): Boolean = httpUrl.containsMatchIn(candidate)

    private val trailingPunctuation = setOf('.', ',', ';', ':', '!', '?', '\'', '"')
    private val openingBracket = mapOf(')' to '(', ']' to '[', '}' to '{', '>' to '<')

    /**
     * A URL written inside a sentence, less the punctuation that ends the sentence or closes a bracket
     * around it: `(https://x.com/a).` is `https://x.com/a`. A closing bracket the URL opened stays, as in
     * `https://en.wikipedia.org/wiki/Teak_(wood)`. Port of `trimTrailingUrlPunctuation`.
     */
    private fun trimTrailingUrlPunctuation(url: String): String {
        var end = url.length
        while (end > 0) {
            val last = url[end - 1]
            val opening = openingBracket[last]
            val head = url.substring(0, end)
            if (last in trailingPunctuation || (opening != null && head.count { it == last } > head.count { it == opening })) {
                end -= 1
            } else {
                break
            }
        }
        return url.substring(0, end)
    }

    fun extractUrl(content: String): Pair<String?, String> {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return null to ""
        if (urlOnly.matches(trimmed)) {
            val url = unescape(trimmed)
            return if (isHttpUrl(url)) url to url else null to trimmed
        }
        urlInline.find(trimmed)?.let { match ->
            val url = trimTrailingUrlPunctuation(unescape(match.groupValues[1]))
            if (isHttpUrl(url)) return url to trimmed
        }
        return null to trimmed
    }

    fun resolve(content: String): TextCardInput {
        val (url, cleaned) = extractUrl(content)
        return if (url != null) {
            TextCardInput(content = cleaned, type = CardType.Link, url = url)
        } else {
            TextCardInput(content = content, type = CardType.Text)
        }
    }
}
