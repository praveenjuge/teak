package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The `[[` picker's rules; Apple's CardLinkPickerTests has the same rows. `^` marks the cursor. */
class CardLinkPickerTest {
    private val linkId = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

    private fun split(marked: String): Pair<String, Int> = marked.replace("^", "") to marked.indexOf('^')

    @Test
    fun `opens for a typed query`() {
        val cases = listOf(
            listOf("just typed", "See [[^", "", 4),
            listOf("a query", "See [[road map^", "road map", 4),
            listOf("spaces around the query", "[[  plan ^", "plan", 0),
            listOf("the cursor mid-query", "[[pla^n", "pla", 0),
            listOf("the last [[ on the line", "[[a]] then [[b^", "b", 11),
            listOf("a third bracket", "[[[x^", "x", 1),
            listOf("after a finished link", "[[Plan|teak:$linkId]] and [[ne^", "ne", 51),
            listOf("a later line", "First\n- [[ta^", "ta", 8),
            listOf("a single bracket inside", "[[a[b^", "a[b", 0),
            listOf("emoji before it", "👩‍👩‍👧‍👦 [[x^", "x", 12),
        )
        for ((name, marked, query, start) in cases) {
            val (text, cursor) = split(marked as String)
            assertEquals(CardLinks.OpenQuery(start as Int, cursor, query as String), CardLinks.openQuery(text, cursor), name as String)
        }
    }

    @Test
    fun `stays closed`() {
        val cases = listOf(
            "no brackets" to "plain text^",
            "one bracket" to "[^",
            "closed" to "[[Plan]]^",
            "a closing bracket typed" to "[[Plan]^",
            "a pipe typed" to "[[Plan|^",
            "on an earlier line" to "[[Plan\nnext^",
            "inside inline code" to "`[[co^de`",
            "inside a fenced block" to "```\n[[co^\n```",
            "in a table row" to "| a | [[b^ |",
            "inside a finished link" to "[[Pl^an|teak:$linkId]]",
            "the cursor before the brackets" to "^[[Plan",
            "past the title limit" to "[[" + "a".repeat(201) + "^",
        )
        for ((name, marked) in cases) {
            val (text, cursor) = split(marked)
            assertNull(CardLinks.openQuery(text, cursor), name)
        }
        assertNull(CardLinks.openQuery("[[a", 9))
        assertNull(CardLinks.openQuery("[[a", -1))
    }

    @Test
    fun `inserts the link in place of the query`() {
        val cases = listOf(
            listOf("at the end", "See [[road^", "Road map", "See [[Road map|teak:$linkId]] ^"),
            listOf("before text", "See [[ro^ today", "Road map", "See [[Road map|teak:$linkId]]^ today"),
            listOf("before a new line", "[[ro^\nNext", "Road map", "[[Road map|teak:$linkId]]^\nNext"),
            listOf("before a word", "[[ro^ad", "Road map", "[[Road map|teak:$linkId]] ^ad"),
            listOf("a title the grammar can't hold", "[[x^", "a | b ]] c\nd", "[[a b c d|teak:$linkId]] ^"),
            listOf("an empty title", "[[^", "  ", "[[Card|teak:$linkId]] ^"),
        )
        for ((name, marked, title, expected) in cases) {
            val (text, cursor) = split(marked)
            val open = assertNotNull(CardLinks.openQuery(text, cursor), name)
            val result = CardLinks.insertingLink(text, open, title, linkId)
            val (wantText, wantCursor) = split(expected)
            assertEquals(CardLinks.Insertion(wantText, wantCursor), result, name)
            assertEquals(listOf(linkId), CardLinks.parseIds(result.text), name)
        }
    }

    @Test
    fun `cuts long titles to the limit`() {
        val open = assertNotNull(CardLinks.openQuery("[[", 2))
        val result = CardLinks.insertingLink("[[", open, "a".repeat(300), linkId)
        val title = CardLinks.find(result.text).single().title
        assertEquals(CARD_LINK_TITLE_MAX_LENGTH, title.length)
        assertTrue(title.endsWith("…"))
    }
}
