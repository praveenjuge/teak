package com.praveenjuge.teak.core.model

/**
 * Ticking a task in a note as the web's editor does (`taskListSort.ts`): flip that one line, then move the item
 * within its own list, below the open items when ticked or to the end of them when unticked. Children move with
 * their item, and every other line stays as written. A port of TeakCore's `TaskLists`.
 */
object TaskLists {
    /** The list's new order after the item at [index] changed to `checked[index]`. */
    fun sortedOrder(checked: List<Boolean>, index: Int): List<Int> {
        val others = checked.indices.filter { it != index }
        var target = 0
        others.forEachIndexed { position, at -> if (!checked[at]) target = position + 1 }
        return others.take(target) + index + others.drop(target)
    }

    /** The note with [item] ticked or unticked and moved, or null when its line no longer holds that task. */
    fun toggle(markdown: String, item: MarkdownListItem): String? {
        val checked = item.checked ?: return null
        val lines = MarkdownBlocks.lines(markdown).toMutableList()
        val task = lines.getOrNull(item.line)?.let(::parseLine) ?: return null
        if (task.checked != checked) return null
        lines[item.line] = task.flipped
        siblings(lines, item.line, task)?.let { group ->
            val moved = reordered(lines, group, item.line)
            for ((offset, text) in moved.withIndex()) lines[group.span.first + offset] = text
        }
        return lines.joinToString(if (markdown.contains("\r\n")) "\r\n" else "\n")
    }

    /** A list item line: its indent, its bullet (or `.`/`)` for a numbered one), and its task state if it's a task. */
    private data class Line(val indent: Int, val bullet: String, val checked: Boolean?, val flipped: String)

    private fun parseLine(text: String): Line? {
        if (MarkdownBlocks.rule.matches(text)) return null
        MarkdownBlocks.bullet.matchEntire(text)?.let { match ->
            val indent = match.groupValues[1].length
            val bullet = match.groupValues[2]
            val box = MarkdownBlocks.task.matchEntire(match.groupValues[3])
                ?: return Line(indent, bullet, null, text)
            val isChecked = box.groupValues[1] != " "
            // Only the character between the brackets changes.
            val at = match.groups[3]!!.range.first + 1
            val flipped = text.substring(0, at) + (if (isChecked) " " else "x") + text.substring(at + 1)
            return Line(indent, bullet, isChecked, flipped)
        }
        MarkdownBlocks.ordered.matchEntire(text)?.let { match ->
            return Line(match.groupValues[1].length, match.groupValues[3], null, text)
        }
        return null
    }

    private class Siblings(val span: IntRange, val starts: List<Int>)

    /**
     * The items sharing a list with the one on [line]: same indent and bullet, with only their children, the text
     * indented under them, and blank lines between them. Null unless every one of them is a task and there are at
     * least two, or when unindented paragraph text runs on from the list's last line, which Markdown joins to that
     * item. A heading, quote, fence, rule or table there ends the list.
     */
    private fun siblings(lines: List<String>, line: Int, task: Line): Siblings? {
        // True for a sibling, false for a line inside an item, null for a line that ends the list.
        fun belongs(index: Int): Boolean? {
            val item = parseLine(lines[index])
                ?: return if (lines[index].takeWhile { it.isWhitespace() }.length > task.indent) false else null
            if (item.indent > task.indent) return false
            return if (item.indent == task.indent && item.bullet == task.bullet) true else null
        }
        var start = line
        var index = line - 1
        while (index >= 0) {
            if (lines[index].isBlank()) {
                index -= 1
                continue
            }
            val isSibling = belongs(index) ?: break
            if (isSibling) start = index
            index -= 1
        }
        var end = line + 1
        index = line + 1
        while (index < lines.size) {
            if (lines[index].isBlank()) {
                index += 1
                continue
            }
            if (belongs(index) == null) {
                if (!lines[index - 1].isBlank() && MarkdownBlocks.continuesParagraph(lines, index)) return null
                break
            }
            index += 1
            end = index
        }
        val starts = (start until end).filter { belongs(it) == true }
        if (starts.size < 2 || starts.any { parseLine(lines[it])?.checked == null }) return null
        return Siblings(start until end, starts)
    }

    /** The items in their new order. Blank lines between items stay where they were, so a loose list stays loose. */
    private fun reordered(lines: List<String>, group: Siblings, toggled: Int): List<String> {
        val starts = group.starts
        val items = mutableListOf<List<String>>()
        val gaps = mutableListOf<List<String>>()
        for (at in starts.indices) {
            val span = lines.subList(starts[at], if (at + 1 < starts.size) starts[at + 1] else group.span.last + 1)
            val kept = span.dropLastWhile(String::isBlank)
            items += kept
            gaps += span.drop(kept.size)
        }
        val checked = starts.map { parseLine(lines[it])?.checked == true }
        val order = sortedOrder(checked, starts.indexOf(toggled))
        return order.indices.flatMap { position -> items[order[position]] + gaps[position] }
    }
}
