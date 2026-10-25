package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Mirrors the web's `searchSuggestions.test.ts` for the hints the apps offer, and Apple's `suggestsExcludeAndOrAsHints`. */
class SearchSuggestionsTest {
    private fun inserts(text: String) = SearchSuggestions.build(text).map { it.insert }

    @Test
    fun `a key prefix suggests the key with what it does`() {
        assertEquals(listOf("type:", "tag:", "text:").sorted(), inserts("t").sorted())
        val price = SearchSuggestions.build("pr").single()
        assertEquals(UiText.verbatim("price:"), price.label)
        assertEquals(UiText.of("search.suggestions.hints.price"), price.detail)
        assertEquals("Filters", price.group)
        assertTrue(inserts("").isEmpty())
        assertTrue(inserts("design ").isEmpty())
    }

    @Test
    fun `a minus offers the filters to leave out`() {
        val exclude = SearchSuggestions.build("design -")
        assertEquals(listOf("-tag:", "-type:", "-site:", "-folder:", "-is:"), exclude.map { it.insert })
        assertTrue(exclude.all { it.group == "Exclude" && !it.complete })
        assertEquals(UiText.of("search.suggestions.groups.exclude"), exclude.first().groupText)
        assertEquals(listOf("-is:"), inserts("-i"))
        assertEquals(listOf("-type:image"), inserts("notes -type:ima"))
        assertEquals("notes -type:image ", SearchSuggestions.build("notes -type:ima").single().accept("notes -type:ima"))
        assertTrue(inserts("--x").isEmpty())
    }

    @Test
    fun `OR is offered only after a word`() {
        val or = SearchSuggestions.build("design o").first()
        assertEquals("OR ", or.insert)
        assertEquals(UiText.verbatim("OR"), or.label)
        assertEquals(UiText.of("search.suggestions.orDetail"), or.detail)
        assertEquals(UiText.of("search.suggestions.groups.combine"), or.groupText)
        assertEquals("design OR ", or.accept("design o"))
        assertTrue("OR " !in inserts("or"))
        assertTrue("OR " !in inserts("design ora"))
    }

    @Test
    fun `values complete after a key`() {
        assertEquals(listOf("is:fav", "is:archived", "is:done", "is:todo"), inserts("is:"))
        assertEquals(listOf("is:archived"), inserts("is:arch"))
        assertEquals(listOf("type:image"), inserts("type:im"))
        assertEquals(UiText.of("search.suggestions.isOptions.archived"), SearchSuggestions.build("is:arch").single().label)
        assertTrue(inserts("is:archived").isEmpty(), "an exact value needs no suggestion")
        assertTrue(inserts("tag:des").isEmpty(), "tags come from the person's cards, which only the web lists")
        assertEquals("tag:x is:archived ", SearchSuggestions.build("tag:x is:arch").single().accept("tag:x is:arch"))
    }
}
