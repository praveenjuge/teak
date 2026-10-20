package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Mirrors `packages/convex/__tests__/shared/cardLinks.test.ts`. */
class CardLinksTest {
    private val idA = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"
    private val idB = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

    @Test
    fun `parses linked ids outside code`() {
        val cases = listOf(
            Triple("one link", "See [[Plan|teak:$idA]].", listOf(idA)),
            Triple("order kept, duplicates dropped", "[[B|teak:$idB]] then [[A|teak:$idA]] and [[B again|teak:$idB]]", listOf(idB, idA)),
            Triple("an empty title", "[[|teak:$idA]]", listOf(idA)),
            Triple("inline code", "`[[Plan|teak:$idA]]`", emptyList()),
            Triple("double-backtick code", "`` a [[Plan|teak:$idA]] ``", emptyList()),
            Triple("a fenced block", "```\n[[Plan|teak:$idA]]\n```\n[[B|teak:$idB]]", listOf(idB)),
            Triple("a tilde fence", "~~~md\n[[Plan|teak:$idA]]\n~~~", emptyList()),
            Triple("a fence line with an info string inside a block", "```\n```js\n[[Plan|teak:$idA]]\n```", emptyList()),
            Triple("an indented block", "Intro\n\n    [[Plan|teak:$idA]]", emptyList()),
            Triple("a list item's indented paragraph", "- Item\n\n    [[Plan|teak:$idA]]", listOf(idA)),
            Triple("an ordered item's indented continuation", "1. Item\n    [[Plan|teak:$idA]]", listOf(idA)),
            Triple("a nested item's indented paragraph", "- Outer\n    - Inner\n\n      [[Plan|teak:$idA]]", listOf(idA)),
            Triple("an indented block inside a list item", "- Item\n\n      [[Plan|teak:$idA]]", emptyList()),
            Triple("an indented block after a list ends", "- Item\n\nParagraph\n\n    [[Plan|teak:$idA]]", emptyList()),
            Triple("an unclosed backtick", "`oops [[Plan|teak:$idA]]", listOf(idA)),
            Triple("no id", "[[x|teak:]]", emptyList()),
            Triple("no prefix", "[[x]]", emptyList()),
            Triple("an uppercase id", "[[x|teak:K17A8M9X2P3Q4R5S]]", emptyList()),
            Triple("a too-short id", "[[x|teak:abc]]", emptyList()),
            Triple("a pipe in the title", "[[a|b|teak:$idA]]", emptyList()),
            Triple("a newline in the title", "[[a\nb|teak:$idA]]", emptyList()),
        )
        for ((name, markdown, ids) in cases) assertEquals(ids, CardLinks.parseIds(markdown), name)
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
    fun `replaces characters the grammar can't hold`() {
        assertEquals("[[a b c d|teak:$idA]]", CardLinks.formatToken("a | b ]] c\nd", idA))
        assertEquals("[[Card|teak:$idA]]", CardLinks.formatToken("   ", idA))
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
    fun `an emoji at the cut is kept whole or dropped whole`() {
        val family = "👩‍👩‍👧‍👦"
        val cases = listOf(
            "c".repeat(185) + family + "d".repeat(30) to "c".repeat(185) + family + "ddd…",
            "c".repeat(190) + family + "d".repeat(30) to "c".repeat(190) + "…",
            "c".repeat(198) + "😀😀" to "c".repeat(198) + "…",
        )
        for ((title, expected) in cases) {
            assertEquals(expected, CardLinks.PATTERN.find(CardLinks.formatToken(title, idA))!!.groupValues[1])
        }
    }

    @Test
    fun `a short title is kept`() {
        assertEquals("[[Reading list|teak:$idA]]", CardLinks.formatToken("Reading list", idA))
    }

    @Test
    fun `shows each link as its stored title, leaving code alone`() {
        assertEquals("Read Plan and `[[Raw|teak:$idB]]`", CardLinks.tokensToText("Read [[Plan|teak:$idA]] and `[[Raw|teak:$idB]]`"))
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

    @Test
    fun `keeps backticks in a title`() {
        assertEquals("See Use `foo`.", CardLinks.tokensToText("See [[Use `foo`|teak:$idA]]."))
    }

    @Test
    fun `text with no links is returned as is`() {
        assertEquals("plain [[x]] text", CardLinks.tokensToText("plain [[x]] text"))
    }
}
