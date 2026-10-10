package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LibraryFiltersTest {
    @Test
    fun `sends only the filters that are on to the search query`() {
        assertEquals(emptyMap(), LibraryFilters.Empty.toSearchArgs())
        assertEquals(
            mapOf(
                "favoritesOnly" to true,
                "hueFilters" to listOf("blue"),
                "showTrashOnly" to true,
                "types" to listOf("image", "link"),
            ),
            LibraryFilters(
                favoritesOnly = true,
                trashOnly = true,
                types = listOf(CardType.Image, CardType.Link),
                hue = ColorHue.Blue,
            ).toSearchArgs(),
        )
    }

    @Test
    fun `toggling a type adds it, then removes it`() {
        val withImages = LibraryFilters.Empty.toggleType(CardType.Image)
        assertEquals(listOf(CardType.Image), withImages.types)
        assertTrue(withImages.isActive)
        assertEquals(emptyList(), withImages.toggleType(CardType.Image).types)
        assertFalse(withImages.toggleType(CardType.Image).isActive)
    }

    @Test
    fun `titles follow the filter like iOS`() {
        val cases = listOf(
            LibraryFilters.Empty to "Home",
            LibraryFilters(trashOnly = true, favoritesOnly = true) to "Trash",
            LibraryFilters(favoritesOnly = true) to "Favorites",
            LibraryFilters(types = listOf(CardType.Text)) to "Notes",
            LibraryFilters(favoritesOnly = true, types = listOf(CardType.Link)) to "Favorite Links",
            LibraryFilters(hue = ColorHue.Teal) to "Teal",
            LibraryFilters(types = listOf(CardType.Text, CardType.Link)) to "Filtered",
        )
        for ((filters, title) in cases) assertEquals(title, filters.title, "$filters")
    }
}
