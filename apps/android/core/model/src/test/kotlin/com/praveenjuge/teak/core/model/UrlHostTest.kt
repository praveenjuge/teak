package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals

/** Runs the rows in `urlHost.json`, which `packages/convex/__tests__/shared/utils/urlHost.test.ts` runs too. */
class UrlHostTest {
    @Serializable
    private data class NormalizeRow(val input: String, val host: String?)

    @Serializable
    private data class DisplayRow(val host: String, val display: String)

    @Serializable
    private data class Rows(val normalize: List<NormalizeRow>, val display: List<DisplayRow>)

    private val rows = Fixtures.load<Rows>("urlHost")

    @Test
    fun `reads a site the way the backend does`() {
        for (row in rows.normalize) assertEquals(row.host, UrlHost.normalize(row.input), row.input)
    }

    @Test
    fun `shows punycode hosts in Unicode`() {
        for (row in rows.display) assertEquals(row.display, UrlHost.forDisplay(row.host), row.host)
    }

    @Test
    fun `a card's site reads the same way`() {
        assertEquals("例え.jp", CardSheet.hostname("https://www.例え.jp/パス"))
        assertEquals("github.com", CardSheet.hostname("https://WWW.GitHub.com./teak"))
        assertEquals(null, CardSheet.hostname("mailto:someone@example.com"))
    }
}
