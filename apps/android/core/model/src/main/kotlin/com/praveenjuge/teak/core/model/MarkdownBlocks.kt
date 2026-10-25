package com.praveenjuge.teak.core.model

sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class ListBlock(val items: List<MarkdownListItem>) : MarkdownBlock
    data class Table(val table: MarkdownTable) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Code(val text: String) : MarkdownBlock
    data object Rule : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
}

/**
 * A list item. [checked] is a task item's state (`- [x]` is true, `- [ ]` false) and null for a plain one;
 * [line] is the item's line in the note, counting from 0: the line a tap on its checkbox flips.
 */
data class MarkdownListItem(
    val depth: Int,
    val marker: String,
    val text: String,
    val checked: Boolean? = null,
    val line: Int = 0,
)

/** A GFM table: a header row and body rows of inline Markdown, every row as wide as the header. */
data class MarkdownTable(val header: List<String>, val rows: List<List<String>>)

object MarkdownBlocks {
    private val heading = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    internal val bullet = Regex("^(\\s*)([-*+])\\s+(.*)$")
    internal val ordered = Regex("^(\\s*)(\\d{1,9})([.)])\\s+(.*)$")
    internal val task = Regex("^\\[([ xX])] (.*)$")
    private val quote = Regex("^\\s{0,3}>\\s?(.*)$")
    internal val rule = Regex("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
    private val fence = Regex("^\\s{0,3}(`{3,}|~{3,})")
    private val delimiterRow = Regex("^\\s{0,3}\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$")

    /** The note's lines, split the same way for rendering and for ticking a task. */
    internal fun lines(markdown: String): List<String> = markdown.replace(Regex("\r\n?"), "\n").split("\n")

    private fun listItem(line: String, index: Int = 0): MarkdownListItem? {
        bullet.matchEntire(line)?.let {
            val depth = it.groupValues[1].length / 2
            val text = it.groupValues[3]
            val box = task.matchEntire(text) ?: return MarkdownListItem(depth, "•", text, line = index)
            return MarkdownListItem(depth, "•", box.groupValues[2], checked = box.groupValues[1] != " ", line = index)
        }
        ordered.matchEntire(line)?.let {
            return MarkdownListItem(it.groupValues[1].length / 2, "${it.groupValues[2]}.", it.groupValues[4], line = index)
        }
        return null
    }

    private fun startsBlock(line: String): Boolean =
        fence.containsMatchIn(line) || heading.matches(line) || quote.matches(line) ||
            rule.matches(line) || listItem(line) != null

    /**
     * Whether [line] closes a fence opened with [marker]: the same character, at least as many times, and nothing
     * else, so a shorter fence inside a longer one stays part of the code.
     */
    private fun closesFence(line: String, marker: String): Boolean {
        val trimmed = line.trim()
        return trimmed.length >= marker.length && trimmed.all { it == marker.first() }
    }

    /** Whether `lines[index]` runs on as paragraph text: not blank, and not the start of another block or a table. */
    internal fun continuesParagraph(lines: List<String>, index: Int): Boolean =
        lines[index].isNotBlank() && !startsBlock(lines[index]) && table(lines, index) == null

    private fun indent(line: String): Int = line.takeWhile { it == ' ' || it == '\t' }.length

    /** A row's cells, split on unescaped pipes after dropping the outer ones, as the web counts them. */
    internal fun cells(line: String): List<String> {
        var row = line.trim()
        if (row.startsWith("|")) row = row.drop(1)
        if (row.endsWith("|") && !row.endsWith("\\|")) row = row.dropLast(1)
        val cells = mutableListOf<String>()
        val cell = StringBuilder()
        var escaped = false
        for (char in row) {
            if (char == '|' && !escaped) {
                cells += cell.toString()
                cell.clear()
            } else {
                cell.append(char)
            }
            escaped = char == '\\' && !escaped
        }
        cells += cell.toString()
        return cells.map { it.trim().replace("\\|", "|") }
    }

    private data class FoundTable(val table: MarkdownTable?, val end: Int)

    /**
     * The table whose header row is `lines[index]`, and the line after it. `table` is null for one the web keeps
     * literal: aligned columns, or a row with a different number of cells.
     */
    private fun table(lines: List<String>, index: Int): FoundTable? {
        if (index + 1 >= lines.size || lines[index].isBlank() || indent(lines[index]) >= 4) return null
        val delimiter = lines[index + 1]
        if (!delimiterRow.matches(delimiter) || !(delimiter.contains('|') || delimiter.contains(':'))) return null
        val header = cells(lines[index])
        val alignments = cells(delimiter)
        if (header.size != alignments.size) return null
        var end = index + 2
        while (end < lines.size && lines[end].isNotBlank() && !startsBlock(lines[end])) end += 1
        val rows = lines.subList(index + 2, end).map(::cells)
        val aligned = alignments.any { it.contains(':') }
        val ragged = rows.any { it.size != header.size }
        return FoundTable(if (aligned || ragged) null else MarkdownTable(header, rows), end)
    }

    private val inlineLink = Regex("\\[([^\\]]+)]\\([^)]*\\)")
    private val emphasis = Regex("(\\*\\*|__|\\*|_|~~|`)(\\S(?:.*?\\S)?)\\1")

    fun toPlainText(markdown: String): String = parse(markdown).joinToString("\n") { block ->
        val text = when (block) {
            is MarkdownBlock.Heading -> block.text
            is MarkdownBlock.ListBlock -> block.items.joinToString("\n") { "${it.marker} ${it.text}" }
            // As the web's tiles read a table: cells joined by " · ", rows by " / ", empty ones left out.
            is MarkdownBlock.Table -> (listOf(block.table.header) + block.table.rows)
                .map { row -> row.filter(String::isNotEmpty).joinToString(" · ") }
                .filter(String::isNotEmpty)
                .joinToString(" / ")
            is MarkdownBlock.Quote -> block.text
            is MarkdownBlock.Code -> block.text
            MarkdownBlock.Rule -> ""
            is MarkdownBlock.Paragraph -> block.text
        }
        text.replace(inlineLink, "$1").replace(emphasis, "$2")
    }.trim()

    fun parse(markdown: String): List<MarkdownBlock> {
        val blocks = mutableListOf<MarkdownBlock>()
        val lines = lines(markdown)
        var index = 0
        // Where the last list ended: a table right after it, or indented under it, is nested in it.
        var listEnd: Int? = null
        while (index < lines.size) {
            val line = lines[index]
            if (line.isBlank()) {
                index += 1
                continue
            }
            val afterList = listEnd
            listEnd = null
            val fenceMatch = fence.find(line)
            if (fenceMatch != null) {
                val marker = fenceMatch.groupValues[1]
                val code = mutableListOf<String>()
                index += 1
                while (index < lines.size && !closesFence(lines[index], marker)) {
                    code += lines[index]
                    index += 1
                }
                index += 1
                blocks += MarkdownBlock.Code(code.joinToString("\n"))
                continue
            }
            // Text indented four spaces outside a list is code, so a `- [ ]` written there shows and can't be ticked.
            if (indent(line) >= 4 && afterList == null) {
                val code = mutableListOf<String>()
                while (index < lines.size && (lines[index].isBlank() || indent(lines[index]) >= 4)) {
                    val text = lines[index]
                    code += if (text.startsWith("\t")) text.drop(1) else text.drop(minOf(4, indent(text)))
                    index += 1
                }
                while (code.lastOrNull()?.isBlank() == true) code.removeAt(code.lastIndex)
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
                    val item = listItem(lines[index], index) ?: break
                    items += item
                    index += 1
                }
                blocks += MarkdownBlock.ListBlock(items)
                listEnd = index
                continue
            }
            val found = table(lines, index)
            if (found != null) {
                val nested = afterList != null && (afterList == index || indent(line) >= 2)
                blocks += if (found.table != null && !nested) {
                    MarkdownBlock.Table(found.table)
                } else {
                    // The web shows these as literal Markdown, so they keep their pipes here too.
                    MarkdownBlock.Code(lines.subList(index, found.end).joinToString("\n"))
                }
                index = found.end
                continue
            }
            val paragraph = mutableListOf(line)
            index += 1
            while (index < lines.size && continuesParagraph(lines, index)) {
                paragraph += lines[index]
                index += 1
            }
            blocks += MarkdownBlock.Paragraph(paragraph.joinToString("\n"))
        }
        return blocks
    }
}
