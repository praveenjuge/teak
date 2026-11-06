package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Runs the rows in `searchTokens.json`, which `packages/convex/__tests__/shared/search/tokenization.test.ts` runs too. */
class SearchFacetsTest {
    @Serializable
    private data class Row(val token: String, val kind: String, val value: String)

    @Serializable
    private data class Rows(val classify: List<Row>)

    @Test
    fun `reads style, color and hex words the way the web does`() {
        for (row in Fixtures.load<Rows>("searchTokens").classify) {
            val token = SearchFacets.classify(row.token)
            assertEquals(row.kind to row.value, token?.let { it.kind.name.lowercase() to it.value }, row.token)
        }
        assertNull(SearchFacets.classify("..."))
    }

    @Test
    fun `lifts facet words out of the text and keeps the rest as typed`() {
        assertEquals(
            SearchFacets("posters tag:blue", hues = listOf("blue"), styles = listOf("minimal"), hexes = listOf("#3B82F6")),
            SearchFacets.split("minimal Blue, #3b82f6 posters tag:blue blue"),
        )
    }

    @Test
    fun `leaves quoted words and searches with operators alone`() {
        assertEquals(SearchFacets("\"blue whale\"", styles = listOf("minimal")), SearchFacets.split("\"blue whale\" minimal"))
        assertEquals(SearchFacets("blue OR red"), SearchFacets.split("blue OR red"))
        assertEquals(SearchFacets("-blue"), SearchFacets.split("-blue"))
    }

    @Test
    fun `an escaped quote inside a phrase doesn't end it`() {
        assertEquals(
            SearchFacets("\"say \\\" blue whale\"", hues = listOf("blue")),
            SearchFacets.split("\"say \\\" blue whale\" blue"),
        )
    }

    @Test
    fun `sends the lifted words as filters beside the color picked from the menu`() {
        assertEquals(
            mapOf(
                "hueFilters" to listOf("red", "blue"),
                "styleFilters" to listOf("retro"),
                "searchQuery" to "posters",
            ),
            LibraryFilters(hue = ColorHue.Red).toSearchArgs("retro blue posters red"),
        )
    }
}
