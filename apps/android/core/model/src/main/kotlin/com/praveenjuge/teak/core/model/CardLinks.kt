package com.praveenjuge.teak.core.model

import java.text.BreakIterator

/**
 * `[[Title|teak:<cardId>]]` links between cards. A port of `packages/convex/shared/cardLinks.ts`;
 * keep them in step. The id is the link; the stored title is only a fallback.
 */
object CardLinks {
    private const val TOKEN = "\\[\\[([^\\]|\\n]{0,200})\\|teak:([a-z0-9]{16,64})\\]\\]"
    val PATTERN = Regex(TOKEN)
    private val TITLE_UNSAFE = Regex("[|\\]\\r\\n]+")
    private val SPACES = Regex("\\s+")
    private val FENCE = Regex("^ {0,3}(`{3,}|~{3,})")
    private val CLOSING_FENCE = Regex("^ {0,3}(`{3,}|~{3,})[ \\t]*$")
    private val BACKTICK_RUN = Regex("`+")
    private val LEADING_SPACE = Regex("^[ \\t]+")
    private val LIST_ITEM = Regex("^( *)([-+*]|\\d{1,9}[.)])( {1,4}|$)")
    private const val CODE_INDENT = 4
    private const val ELLIPSIS = "…"
    private const val FALLBACK_TITLE = "Card"

    /** A link inside a note: [start] and [end] index the original text. */
    data class Match(val start: Int, val end: Int, val id: String, val title: String)

    fun mayHaveLinks(markdown: String?): Boolean = markdown?.contains("|teak:") == true

    private fun graphemes(value: String): List<String> {
        val iterator = BreakIterator.getCharacterInstance().apply { setText(value) }
        val parts = mutableListOf<String>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            parts += value.substring(start, end)
            start = end
            end = iterator.next()
        }
        return parts
    }

    private fun truncate(title: String, max: Int): String {
        if (title.length <= max) return title
        val result = StringBuilder()
        for (part in graphemes(title)) {
            if (result.length + part.length + ELLIPSIS.length > max) break
            result.append(part)
        }
        return result.toString().trimEnd() + ELLIPSIS
    }

    fun tokenTitle(title: String): String {
        val safe = title.replace(TITLE_UNSAFE, " ").replace(SPACES, " ").trim()
        return truncate(safe.ifEmpty { FALLBACK_TITLE }, CARD_LINK_TITLE_MAX_LENGTH)
    }

    fun formatToken(title: String, id: String): String = "[[${tokenTitle(title)}|teak:$id]]"

    private fun blank(text: String): String = text.replace(Regex("[^\\n]"), " ")

    private fun maskCodeSpans(line: String): String {
        val runs = BACKTICK_RUN.findAll(line).toList()
        var masked = line
        var index = 0
        while (index < runs.size) {
            val open = runs[index]
            val closeIndex = (index + 1 until runs.size).firstOrNull { runs[it].value.length == open.value.length }
            if (closeIndex == null) {
                index += 1
                continue
            }
            val start = open.range.first
            val end = runs[closeIndex].range.last + 1
            masked = masked.substring(0, start) + blank(masked.substring(start, end)) + masked.substring(end)
            index = closeIndex + 1
        }
        return masked
    }

    /** [markdown] with code blocks and inline code replaced by spaces, so every index still points at the original. */
    private fun maskCode(markdown: String): String {
        var fence: String? = null
        var previousBlank = true
        var inIndented = false
        var listContent = 0
        return markdown.split("\n").joinToString("\n") { line ->
            val open = fence
            if (open != null) {
                val closing = CLOSING_FENCE.find(line)
                if (closing != null && closing.groupValues[1][0] == open[0] && closing.groupValues[1].length >= open.length) {
                    fence = null
                }
                return@joinToString blank(line)
            }
            val fenceMatch = FENCE.find(line)
            if (fenceMatch != null) {
                fence = fenceMatch.groupValues[1]
                return@joinToString blank(line)
            }
            val isBlank = line.isBlank()
            val expanded = LEADING_SPACE.replace(line) { it.value.replace("\t", "    ") }
            val columns = expanded.length - expanded.trimStart().length
            inIndented = !isBlank && columns >= listContent + CODE_INDENT && (inIndented || previousBlank)
            if (!(isBlank || inIndented)) {
                val item = LIST_ITEM.find(expanded)
                if (item != null && item.groupValues[1].length < listContent + CODE_INDENT) {
                    listContent = item.value.length + if (item.groupValues[3].isNotEmpty()) 0 else 1
                } else if (previousBlank && columns < listContent) {
                    listContent = 0
                }
            }
            previousBlank = isBlank
            if (inIndented) blank(line) else maskCodeSpans(line)
        }
    }

    /** Every link outside code, in order. */
    fun find(markdown: String): List<Match> {
        if (!mayHaveLinks(markdown)) return emptyList()
        return PATTERN.findAll(maskCode(markdown)).map { match ->
            val titleStart = match.range.first + 2
            Match(
                start = match.range.first,
                end = match.range.last + 1,
                id = match.groupValues[2],
                title = markdown.substring(titleStart, titleStart + match.groupValues[1].length),
            )
        }.toList()
    }

    /** Linked card ids in order, unique, at most [MAX_CARD_LINKS]; code excluded. */
    fun parseIds(markdown: String?): List<String> {
        val ids = LinkedHashSet<String>()
        for (match in find(markdown.orEmpty())) {
            if (ids.size >= MAX_CARD_LINKS) break
            ids += match.id
        }
        return ids.toList()
    }

    fun replaceTokens(markdown: String, replace: (title: String, id: String) -> String): String {
        val matches = find(markdown)
        if (matches.isEmpty()) return markdown
        val result = StringBuilder()
        var cursor = 0
        for (match in matches) {
            result.append(markdown, cursor, match.start).append(replace(match.title, match.id))
            cursor = match.end
        }
        return result.append(markdown.substring(cursor)).toString()
    }

    fun tokensToText(markdown: String): String = replaceTokens(markdown) { title, _ -> title }
}
