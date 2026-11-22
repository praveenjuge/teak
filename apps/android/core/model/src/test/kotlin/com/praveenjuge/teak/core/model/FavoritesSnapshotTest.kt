package com.praveenjuge.teak.core.model

import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FavoritesSnapshotTest {
    @get:Rule val temp = TemporaryFolder()

    private val cardId = "k57a3b9cd0e1f2g3h4j5m6n7p8q9r0s1"

    private fun summary(
        type: CardType = CardType.Link,
        title: String = "Card",
        previewText: String? = null,
        url: String? = null,
        colors: List<String>? = null,
        archived: Boolean? = null,
        linkPreviewImageUrl: String? = null,
    ) = CardSummary(
        id = cardId, creationTime = 1.0, type = type, title = title, previewText = previewText, url = url,
        colors = colors, isArchived = archived, linkPreviewImageUrl = linkPreviewImageUrl,
    )

    @Test
    fun `keeps what a tile shows and leaves archived cards out`() {
        assertNull(FavoritesSnapshot.Card.from(summary(archived = true)))

        val palette = summary(
            type = CardType.Palette, title = "Sunset",
            colors = listOf("#ff8800", "abc", "#11223380", "not a color", "#000000", "#FFFFFF", "#123456"),
        )
        val (card, thumbnail) = FavoritesSnapshot.Card.from(palette)!!
        // Stored as #RRGGBB, alpha dropped, bad values skipped, at most five.
        assertEquals(listOf("#FF8800", "#AABBCC", "#112233", "#000000", "#FFFFFF"), card.colors)
        assertNull(card.image)
        assertNull(thumbnail)

        val (link, linkThumbnail) = FavoritesSnapshot.Card.from(
            summary(title = "", url = "https://www.example.com/a", linkPreviewImageUrl = "https://cdn.example.com/a.jpg?sig=1"),
        )!!
        assertEquals("example.com", link.title)
        assertEquals("https://cdn.example.com/a.jpg?sig=1", linkThumbnail)
        assertTrue(link.image!!.startsWith("$cardId-"))

        val note = FavoritesSnapshot.Card.from(summary(type = CardType.Text, title = "", previewText = "**Buy** milk"))!!
        assertEquals("Buy milk", note.first.title)
    }

    @Test
    fun `a new thumbnail gets a new file but a re-signed one does not`() {
        fun image(url: String) = FavoritesSnapshot.Card.from(summary(linkPreviewImageUrl = url))!!.first.image
        assertEquals(image("https://cdn.example.com/a.jpg?sig=1"), image("https://cdn.example.com/a.jpg?sig=2"))
        assertNotEquals(image("https://cdn.example.com/a.jpg"), image("https://cdn.example.com/b.jpg"))
        assertNull(image("javascript:alert(1)"))
    }

    @Test
    fun `writes, reads and drops thumbnails it no longer names`() {
        val folder = FavoritesSnapshot.folder(temp.root)
        val first = FavoritesSnapshot(listOf(FavoritesSnapshot.Card(cardId, CardType.Image, image = "a-1.jpg")))
        first.write(folder, mapOf("a-1.jpg" to byteArrayOf(1)))
        assertEquals(first, FavoritesSnapshot.read(folder))

        val second = FavoritesSnapshot(listOf(FavoritesSnapshot.Card(cardId, CardType.Image, image = "a-2.jpg")))
        second.write(folder, mapOf("a-2.jpg" to byteArrayOf(2)))
        assertEquals(setOf("favorites.json", "a-2.jpg"), folder.list()!!.toSet())

        assertTrue(FavoritesSnapshot.clear(folder))
        assertEquals(FavoritesSnapshot(), FavoritesSnapshot.read(folder))
        assertFalse(FavoritesSnapshot.clear(folder))
    }

    @Test
    fun `asks for a full page of the newest favorites`() {
        val args = FavoritesSnapshot.searchArgs
        assertEquals(true, args["favoritesOnly"])
        assertNull(args["searchQuery"])
        assertEquals(mapOf("numItems" to 100, "cursor" to null), args["paginationOpts"])
    }
}
