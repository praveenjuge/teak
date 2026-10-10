package com.praveenjuge.teak.core.model

/** How a note or pasted link is saved: a link card when there is an http(s) URL, otherwise text. */
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

    /** The URL in [content], and the content to save alongside it. */
    fun extractUrl(content: String): Pair<String?, String> {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return null to ""
        if (urlOnly.matches(trimmed)) {
            val url = unescape(trimmed)
            return if (isHttpUrl(url)) url to url else null to trimmed
        }
        urlInline.find(trimmed)?.let { match ->
            val url = unescape(match.groupValues[1])
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
