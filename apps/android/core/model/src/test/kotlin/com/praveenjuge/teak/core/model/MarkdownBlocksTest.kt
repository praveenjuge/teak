package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class MarkdownBlocksTest {
    @Test
    fun `splits a note into the blocks the web shows`() {
        val note = listOf(
            "# Trip plan",
            "",
            "- Book **train** tickets",
            "  - Window seat",
            "1. Pack",
            "",
            "> Leave early.",
            "> Really.",
            "",
            "---",
            "",
            "```",
            "# not a heading",
            "```",
            "Plain line one",
            "line two #travel",
        ).joinToString("\n")

        assertEquals(
            listOf(
                MarkdownBlock.Heading(1, "Trip plan"),
                MarkdownBlock.ListBlock(
                    listOf(
                        MarkdownListItem(0, "•", "Book **train** tickets"),
                        MarkdownListItem(1, "•", "Window seat"),
                        MarkdownListItem(0, "1.", "Pack"),
                    ),
                ),
                MarkdownBlock.Quote("Leave early.\nReally."),
                MarkdownBlock.Rule,
                MarkdownBlock.Code("# not a heading"),
                MarkdownBlock.Paragraph("Plain line one\nline two #travel"),
            ),
            MarkdownBlocks.parse(note),
        )
    }

    @Test
    fun `leaves plain text and hashtags as a paragraph`() {
        assertEquals(
            listOf(MarkdownBlock.Paragraph("#tag is not a heading\nnext")),
            MarkdownBlocks.parse("#tag is not a heading\r\nnext"),
        )
    }

    @Test
    fun `previews drop markdown syntax but keep the words`() {
        assertEquals(
            "Trip plan\n• Book train tickets\nThings the Mac app does, see docs",
            MarkdownBlocks.toPlainText("# Trip plan\n- Book **train** tickets\n\nThings the **Mac app** does, see [docs](https://x.test)"),
        )
    }
}
