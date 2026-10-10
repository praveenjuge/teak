package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class CardEditTest {
    private val card = Card(
        id = "c1",
        creationTime = 0.0,
        type = CardType.Text,
        content = "Original",
        notes = "Old notes",
        tags = listOf("keep"),
        aiTags = listOf("Design", "Color"),
    )

    @Test
    fun `an untouched form saves nothing`() {
        assertEquals(emptyList(), CardEdit.changes(card, CardEdit.draftFor(card)))
    }

    @Test
    fun `turns each edit into the field update the web makes`() {
        val draft = CardEditDraft(
            content = "Rewritten",
            notes = "  ",
            tags = listOf("keep", "new"),
            aiTags = listOf("Design"),
        )
        assertEquals(
            listOf(
                CardFieldChange.Content("Rewritten"),
                CardFieldChange.Notes(null),
                CardFieldChange.Tags(listOf("keep", "new")),
                CardFieldChange.RemoveAiTag("Color"),
            ),
            CardEdit.changes(card, draft),
        )
    }

    @Test
    fun `leaves content alone for types that can't be rewritten`() {
        val link = card.copy(type = CardType.Link)
        val draft = CardEdit.draftFor(link)
        assertEquals(null, draft.content)
        assertEquals(emptyList(), CardEdit.changes(link, draft))
    }

    @Test
    fun `tags are trimmed and lowercase`() {
        assertEquals("inspiration", CardEdit.normalizeTag("  Inspiration "))
    }
}
