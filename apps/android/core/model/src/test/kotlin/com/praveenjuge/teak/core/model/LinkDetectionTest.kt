package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class LinkDetectionTest {
    @Test
    fun `a bare URL becomes a link card with markdown escapes undone`() {
        assertEquals(
            TextCardInput("https://example.com/a_b?x=1&y=2", CardType.Link, "https://example.com/a_b?x=1&y=2"),
            LinkDetection.resolve("  https://example.com/a\\_b?x=1&amp;y=2 "),
        )
    }

    @Test
    fun `text with an inline URL keeps the text and links the URL`() {
        assertEquals(
            TextCardInput("read this https://teakvault.com later", CardType.Link, "https://teakvault.com"),
            LinkDetection.resolve("read this https://teakvault.com later"),
        )
    }

    @Test
    fun `plain text stays a note`() {
        assertEquals(TextCardInput("buy milk", CardType.Text), LinkDetection.resolve("buy milk"))
        assertEquals(TextCardInput("ftp://example.com", CardType.Text), LinkDetection.resolve("ftp://example.com"))
    }
}
