package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Runs the rows in `cardLinks.json`, which `packages/convex/__tests__/shared/cardLinks.test.ts` runs too. */
class CardLinksTest {
    @Serializable
    private data class ParseRow(val name: String, val markdown: String, val ids: List<String>)

    @Serializable
    private data class FormatRow(val name: String, val title: String, val id: String, val token: String)

    @Serializable
    private data class TextRow(val name: String, val markdown: String, val text: String)

    @Serializable
    private data class Rows(val parseIds: List<ParseRow>, val formatToken: List<FormatRow>, val tokensToText: List<TextRow>)

    private val rows = Fixtures.load<Rows>("cardLinks")
    private val idA = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"
    private val idB = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

    @Test
    fun `parses linked ids outside code`() {
        for (row in rows.parseIds) assertEquals(row.ids, CardLinks.parseIds(row.markdown), row.name)
    }

    @Test
    fun `formats tokens the grammar can read back`() {
        for (row in rows.formatToken) assertEquals(row.token, CardLinks.formatToken(row.title, row.id), row.name)
    }

    @Test
    fun `shows each link as its stored title`() {
        for (row in rows.tokensToText) assertEquals(row.text, CardLinks.tokensToText(row.markdown), row.name)
    }

    @Test
    fun `indexes at most 500 distinct targets`() {
        val tokens = (0..500).joinToString(" ") { "[[n|teak:${it.toString().padStart(16, 'a')}]]" }
        val ids = CardLinks.parseIds(tokens)
        assertEquals(MAX_CARD_LINKS, ids.size)
        assertEquals(499.toString().padStart(16, 'a'), ids.last())
    }

    @Test
    fun `handles missing content`() {
        assertEquals(emptyList(), CardLinks.parseIds(null))
    }

    @Test
    fun `reads a long line of code spans in linear time`() {
        // 400 KB of backticks on one line: masking its code spans used to take
        // tens of seconds, past any function's time limit.
        val spans = "`a` ".repeat(50_000)
        val unclosed = "``a ".repeat(50_000)
        val markdown = "$spans[[Plan|teak:$idA]] $unclosed`[[B|teak:$idB]]`"
        val started = System.nanoTime()
        assertEquals(listOf(idA), CardLinks.parseIds(markdown))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 1000)
    }

    @Test
    fun `a long title reads back with the same id`() {
        val family = "👩‍👩‍👧‍👦"
        val titles = listOf("a".repeat(300), "b".repeat(512), "c".repeat(198) + family + family, "漢字".repeat(150), "שלום ".repeat(80))
        for (title in titles) {
            val token = CardLinks.formatToken(title, idA)
            val match = CardLinks.PATTERN.find(token)!!
            assertEquals(idA, match.groupValues[2])
            assertTrue(match.groupValues[1].length <= CARD_LINK_TITLE_MAX_LENGTH)
            assertEquals(listOf(idA), CardLinks.parseIds("x $token y"))
            assertFalse(match.groupValues[1].endsWith("‍…"))
        }
    }

    @Test
    fun `passes the title and id to the replacer`() {
        val seen = mutableListOf<String>()
        val result = CardLinks.replaceTokens("[[A|teak:$idA]]-[[B|teak:$idB]]") { title, id ->
            seen += "$title:$id"
            title.lowercase()
        }
        assertEquals("a-b", result)
        assertEquals(listOf("A:$idA", "B:$idB"), seen)
    }
}
