package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

// Tables and task items in notes. The rows mirror TeakCore's NoteTests (NoteTableTests, NoteTaskTests). Keep them in step.

private const val LINK_ID = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

class NoteBlocksTest {
    @Test
    fun `reads a GFM table with a header row`() {
        assertEquals(
            listOf(MarkdownBlock.Table(MarkdownTable(listOf("Plan", "Price"), listOf(listOf("Free", "$0"), listOf("Pro", "**$8**"))))),
            MarkdownBlocks.parse("| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | **$8** |"),
        )
    }

    @Test
    fun `reads a table without outer pipes or body rows`() {
        assertEquals(
            listOf(MarkdownBlock.Table(MarkdownTable(listOf("Plan", "Price"), emptyList()))),
            MarkdownBlocks.parse("Plan | Price\n--|--"),
        )
    }

    @Test
    fun `keeps every column of a wide table`() {
        val header = (1..12).map { "Column $it" }
        val row = (1..12).map { "Value $it" }
        val note = listOf(
            "| ${header.joinToString(" | ")} |",
            "|" + " --- |".repeat(12),
            "| ${row.joinToString(" | ")} |",
        ).joinToString("\n")
        assertEquals(listOf(MarkdownBlock.Table(MarkdownTable(header, listOf(row)))), MarkdownBlocks.parse(note))
    }

    @Test
    fun `keeps a table the web keeps literal`() {
        listOf(
            "a ragged row" to "| a | b |\n| - | - |\n| 1 |",
            "an aligned column" to "| a | b |\n| :- | - |\n| 1 | 2 |",
            "a header wider than its rows" to "| a | b | c |\n| - | - | - |\n| 1 | 2 |",
        ).forEach { (name, note) ->
            assertEquals(listOf(MarkdownBlock.Code(note)), MarkdownBlocks.parse(note), name)
        }
    }

    @Test
    fun `keeps a table nested in a list literal`() {
        assertEquals(
            listOf(
                MarkdownBlock.ListBlock(listOf(MarkdownListItem(0, "•", "Item", line = 0))),
                MarkdownBlock.Code("  | a | b |\n  | - | - |"),
            ),
            MarkdownBlocks.parse("- Item\n  | a | b |\n  | - | - |"),
        )
        assertEquals(MarkdownBlock.Code("  | a | b |\n  | - | - |"), MarkdownBlocks.parse("- Item\n\n  | a | b |\n  | - | - |").last())
    }

    @Test
    fun `leaves a table in a quote as quote text`() {
        assertEquals(listOf(MarkdownBlock.Quote("| a | b |\n| - | - |")), MarkdownBlocks.parse("> | a | b |\n> | - | - |"))
    }

    @Test
    fun `keeps card links and escaped pipes inside cells`() {
        val table = MarkdownBlocks.parse("| Card | Note |\n| --- | --- |\n| [[Plan\\|teak:$LINK_ID]] | a \\| b |").first() as MarkdownBlock.Table
        assertEquals(listOf(listOf("[[Plan|teak:$LINK_ID]]", "a | b")), table.table.rows)
        assertEquals(listOf(LINK_ID), CardLinks.find(table.table.rows[0][0]).map { it.id })
    }

    @Test
    fun `starts a table after a paragraph and back to back`() {
        assertEquals(
            listOf(
                MarkdownBlock.Paragraph("Intro"),
                MarkdownBlock.Table(MarkdownTable(listOf("a"), listOf(listOf("1")))),
                MarkdownBlock.Table(MarkdownTable(listOf("b"), listOf(listOf("2")))),
            ),
            MarkdownBlocks.parse("Intro\n| a |\n| - |\n| 1 |\n\n| b |\n| - |\n| 2 |"),
        )
    }

    @Test
    fun `leaves a line of dashes as a rule`() {
        assertEquals(listOf(MarkdownBlock.Paragraph("Title"), MarkdownBlock.Rule), MarkdownBlocks.parse("Title\n---"))
    }

    @Test
    fun `reads a table on a tile as the web does`() {
        assertEquals("Plan · Price / Free", MarkdownBlocks.toPlainText("| Plan | Price |\n| --- | --- |\n| **Free** |  |"))
    }

    @Test
    fun `reads task items in a mixed list`() {
        assertEquals(
            listOf(
                MarkdownBlock.ListBlock(
                    listOf(
                        MarkdownListItem(0, "•", "Buy milk", checked = false, line = 0),
                        MarkdownListItem(0, "•", "Call mom", checked = true, line = 1),
                        MarkdownListItem(1, "•", "Nested", checked = true, line = 2),
                        MarkdownListItem(0, "•", "plain", line = 3),
                        MarkdownListItem(0, "•", "[ ]", line = 4),
                        MarkdownListItem(0, "1.", "[ ] numbered", line = 5),
                    ),
                ),
            ),
            MarkdownBlocks.parse("- [ ] Buy milk\n- [x] Call mom\n  * [X] Nested\n- plain\n- [ ]\n1. [ ] numbered"),
        )
    }

    @Test
    fun `counts lines from the top of the note`() {
        val list = MarkdownBlocks.parse("# Today\r\n\r\n- [ ] Plan").last() as MarkdownBlock.ListBlock
        assertEquals(listOf(2), list.items.map { it.line })
    }
}
