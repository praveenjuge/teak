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
    fun `a smart folder saves the filters with the search, like Apple`() {
        assertEquals(
            "type:image is:fav is:archived kerning",
            LibraryFilters(favoritesOnly = true, archivedOnly = true, types = listOf(CardType.Image), hue = ColorHue.Blue)
                .smartFolderQuery("  kerning "),
        )
        assertEquals("kerning", LibraryFilters.Empty.smartFolderQuery("kerning"))
        assertEquals(null, LibraryFilters(trashOnly = true).smartFolderQuery("kerning"))
        assertEquals(null, LibraryFilters.Empty.smartFolderQuery(" "))
    }

    @Test
    fun `archive and trash are separate views`() {
        val archive = LibraryFilters(trashOnly = true).toggleArchive()
        assertEquals(LibraryFilters(archivedOnly = true), archive)
        assertEquals(mapOf("showArchivedOnly" to true), archive.toSearchArgs())
        assertEquals(UiText.of("native.filters.archive"), archive.titleText)
        assertEquals(LibraryFilters(trashOnly = true), archive.toggleTrash())
    }

    @Test
    fun `each shuffle draws a fresh seed and sends it with the sort`() {
        val random = kotlin.random.Random(7)
        val first = LibraryFilters.Empty.sorted(CardSort.Shuffle, random)
        val second = first.sorted(CardSort.Shuffle, random)
        assertTrue(first.shuffleSeed != second.shuffleSeed)
        assertEquals(mapOf("sort" to "shuffle", "shuffleSeed" to second.shuffleSeed), second.toSearchArgs())
        assertEquals(mapOf("sort" to "oldest"), first.sorted(CardSort.Oldest).toSearchArgs())
        assertEquals(emptyMap(), first.sorted(CardSort.Newest).toSearchArgs())
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
            LibraryFilters.Empty to UiText.of("native.filters.home"),
            LibraryFilters(trashOnly = true, favoritesOnly = true) to UiText.of("native.filters.trash"),
            LibraryFilters(favoritesOnly = true) to UiText.of("native.filters.favorites"),
            LibraryFilters(types = listOf(CardType.Text)) to UiText.of("native.filters.types.text"),
            LibraryFilters(favoritesOnly = true, types = listOf(CardType.Link)) to UiText.of("native.filters.favoriteTypes.link"),
            LibraryFilters(hue = ColorHue.Teal) to UiText.of("search.colorHues.teal"),
            LibraryFilters(types = listOf(CardType.Text, CardType.Link)) to UiText.of("native.filters.filtered"),
        )
        for ((filters, title) in cases) assertEquals(title, filters.titleText, "$filters")
    }
}
