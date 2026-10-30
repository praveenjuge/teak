package com.praveenjuge.teak.core.model

import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PendingEditsTest {
    private val note = Card(id = "c1", creationTime = 0.0, type = CardType.Text, content = "Draft", tags = listOf("a"))
    private val tile = CardSummary(id = "c1", creationTime = 0.0, type = CardType.Link, title = "Teak")

    @Test
    fun `edits apply to the card in the order they were made`() {
        val changes = listOf(
            CardFieldChange.Favorite(true),
            CardFieldChange.Content("Final"),
            CardFieldChange.Tags(listOf("a", "b")),
            CardFieldChange.Favorite(false),
            CardFieldChange.MoveToTrash,
        )

        val card = PendingEdits.apply(note, changes, now = 5.0)

        assertEquals("Final", card.content)
        assertEquals(listOf("a", "b"), card.tags)
        assertFalse(card.favorited)
        assertTrue(card.deleted)
    }

    @Test
    fun `done keeps the time a card was first marked done`() {
        assertEquals(5.0, PendingEdits.apply(tile, listOf(CardFieldChange.Done(true)), now = 5.0).completedAt)
        assertEquals(2.0, PendingEdits.apply(tile.copy(completedAt = 2.0), listOf(CardFieldChange.Done(true)), now = 5.0).completedAt)
        assertNull(PendingEdits.apply(tile.copy(completedAt = 2.0), listOf(CardFieldChange.Done(false)), now = 5.0).completedAt)
    }

    @Test
    fun `a tile shows favorite, archive and palette colors`() {
        val palette = tile.copy(type = CardType.Palette, colors = listOf("#FF5500", "#00FF00"))
        val changes = listOf(
            CardFieldChange.Favorite(true),
            CardFieldChange.Archive(true),
            CardFieldChange.AddColor("#FF5500"),
            CardFieldChange.AddColor("#0000FF"),
            CardFieldChange.RemoveColor("#00FF00"),
        )

        val shown = PendingEdits.apply(palette, changes, now = 0.0)

        assertEquals(true, shown.isFavorited)
        assertTrue(shown.archived)
        assertEquals(listOf("#FF5500", "#0000FF"), shown.colors)
    }

    @Test
    fun `a card leaves a view its edits move it out of`() {
        val home = LibraryFilters()
        assertFalse(PendingEdits.keepsInView(listOf(CardFieldChange.MoveToTrash), home))
        assertFalse(PendingEdits.keepsInView(listOf(CardFieldChange.Archive(true)), home))
        assertTrue(PendingEdits.keepsInView(listOf(CardFieldChange.Archive(true), CardFieldChange.Archive(false)), home))
        assertFalse(PendingEdits.keepsInView(listOf(CardFieldChange.Restore), LibraryFilters(trashOnly = true)))
        assertFalse(PendingEdits.keepsInView(listOf(CardFieldChange.Archive(false)), LibraryFilters(archivedOnly = true)))
        assertFalse(PendingEdits.keepsInView(listOf(CardFieldChange.Favorite(false)), LibraryFilters(favoritesOnly = true)))
        assertTrue(PendingEdits.keepsInView(listOf(CardFieldChange.Content("x")), home))
    }

    @Test
    fun `an edit keeps its type and value when saved and read back`() {
        val changes = listOf(CardFieldChange.Notes(null), CardFieldChange.Done(true), CardFieldChange.Restore)
        val encoded = Json.encodeToString(changes)

        assertEquals(changes, Json.decodeFromString<List<CardFieldChange>>(encoded))
    }

    @Test
    fun `favorite, archive and done send the fields the server knows`() {
        assertEquals(mapOf("cardId" to "c1", "field" to "isFavorited", "value" to false), CardFieldChange.Favorite(false).args("c1"))
        assertEquals("unarchive", CardFieldChange.Archive(false).args("c1")["field"])
        assertEquals("done", CardFieldChange.Done(true).args("c1")["field"])
    }
}
