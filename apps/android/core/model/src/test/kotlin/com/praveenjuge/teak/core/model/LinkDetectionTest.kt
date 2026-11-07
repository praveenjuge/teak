package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals

/** Runs the rows in `linkDetection.json`, which `packages/convex/__tests__/shared/utils/linkDetection.test.ts` runs too. */
class LinkDetectionTest {
    @Serializable
    private data class Row(val content: String, val url: String?, val cleanedContent: String)

    @Serializable
    private data class Rows(val extract: List<Row>)

    @Test
    fun `extracts the URL the web would`() {
        for (row in Fixtures.load<Rows>("linkDetection").extract) {
            assertEquals(row.url to row.cleanedContent, LinkDetection.extractUrl(row.content), row.content)
        }
    }

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
    fun `an inline URL drops the punctuation that ends the sentence`() {
        assertEquals("https://example.com/post", LinkDetection.resolve("Read this: https://example.com/post.").url)
        assertEquals("https://x.com/a", LinkDetection.resolve("(see https://x.com/a).").url)
        assertEquals(
            "https://en.wikipedia.org/wiki/Teak_(wood)",
            LinkDetection.resolve("see https://en.wikipedia.org/wiki/Teak_(wood)!").url,
        )
        assertEquals("(see https://x.com/a).", LinkDetection.resolve("(see https://x.com/a).").content)
    }

    @Test
    fun `plain text stays a note`() {
        assertEquals(TextCardInput("buy milk", CardType.Text), LinkDetection.resolve("buy milk"))
        assertEquals(TextCardInput("ftp://example.com", CardType.Text), LinkDetection.resolve("ftp://example.com"))
    }
}
