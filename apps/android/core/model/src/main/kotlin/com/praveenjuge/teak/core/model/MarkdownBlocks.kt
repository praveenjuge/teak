package com.praveenjuge.teak.core.model

/** A block of a Markdown note: the same split the web and iPhone note views use. */
sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class ListBlock(val items: List<MarkdownListItem>) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Code(val text: String) : MarkdownBlock
    data object Rule : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
}

data class MarkdownListItem(val depth: Int, val marker: String, val text: String)

object MarkdownBlocks {
    private val heading = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    private val bullet = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val ordered = Regex("^(\\s*)(\\d{1,9})[.)]\\s+(.*)$")
    private val quote = Regex("^\\s{0,3}>\\s?(.*)$")
    private val rule = Regex("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
    private val fence = Regex("^\\s{0,3}(```|~~~)")

    private fun listItem(line: String): MarkdownListItem? {
        bullet.matchEntire(line)?.let {
            return MarkdownListItem(it.groupValues[1].length / 2, "•", it.groupValues[2])
        }
        ordered.matchEntire(line)?.let {
            return MarkdownListItem(it.groupValues[1].length / 2, "${it.groupValues[2]}.", it.groupValues[3])
        }
        return null
    }

    private fun startsBlock(line: String): Boolean =
        fence.containsMatchIn(line) || heading.matches(line) || quote.matches(line) ||
            rule.matches(line) || listItem(line) != null

    private val inlineLink = Regex("\\[([^\\]]+)]\\([^)]*\\)")
    private val emphasis = Regex("(\\*\\*|__|\\*|_|~~|`)(\\S(?:.*?\\S)?)\\1")

    /** A note as plain lines for small previews: block markers and inline emphasis removed. */
    fun toPlainText(markdown: String): String = parse(markdown).joinToString("\n") { block ->
        val text = when (block) {
            is MarkdownBlock.Heading -> block.text
            is MarkdownBlock.ListBlock -> block.items.joinToString("\n") { "${it.marker} ${it.text}" }
            is MarkdownBlock.Quote -> block.text
            is MarkdownBlock.Code -> block.text
            MarkdownBlock.Rule -> ""
            is MarkdownBlock.Paragraph -> block.text
        }
        text.replace(inlineLink, "$1").replace(emphasis, "$2")
    }.trim()

    fun parse(markdown: String): List<MarkdownBlock> {
        val blocks = mutableListOf<MarkdownBlock>()
        val lines = markdown.replace(Regex("\r\n?"), "\n").split("\n")
        var index = 0
        while (index < lines.size) {
            val line = lines[index]
            if (line.isBlank()) {
                index += 1
                continue
            }
            val fenceMatch = fence.find(line)
            if (fenceMatch != null) {
                val marker = fenceMatch.groupValues[1]
                val code = mutableListOf<String>()
                index += 1
                while (index < lines.size && !lines[index].trim().startsWith(marker)) {
                    code += lines[index]
                    index += 1
                }
                index += 1
                blocks += MarkdownBlock.Code(code.joinToString("\n"))
                continue
            }
            val headingMatch = heading.matchEntire(line)
            if (headingMatch != null) {
                blocks += MarkdownBlock.Heading(headingMatch.groupValues[1].length, headingMatch.groupValues[2])
                index += 1
                continue
            }
            if (rule.matches(line)) {
                blocks += MarkdownBlock.Rule
                index += 1
                continue
            }
            if (quote.matches(line)) {
                val text = mutableListOf<String>()
                while (index < lines.size) {
                    val match = quote.matchEntire(lines[index]) ?: break
                    text += match.groupValues[1]
                    index += 1
                }
                blocks += MarkdownBlock.Quote(text.joinToString("\n"))
                continue
            }
            if (listItem(line) != null) {
                val items = mutableListOf<MarkdownListItem>()
                while (index < lines.size) {
                    val item = listItem(lines[index]) ?: break
                    items += item
                    index += 1
                }
                blocks += MarkdownBlock.ListBlock(items)
                continue
            }
            val paragraph = mutableListOf<String>()
            while (index < lines.size && lines[index].isNotBlank() && !startsBlock(lines[index])) {
                paragraph += lines[index]
                index += 1
            }
            blocks += MarkdownBlock.Paragraph(paragraph.joinToString("\n"))
        }
        return blocks
    }
}
