package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
            editableContent = "Rewritten",
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
        assertEquals(null, draft.editableContent)
        assertEquals(emptyList(), CardEdit.changes(link, draft))
    }

    @Test
    fun `tags are trimmed and lowercase`() {
        assertEquals("inspiration", CardEdit.normalizeTag("  Inspiration "))
    }

    @Test
    fun `keeping a suggested tag writes the tags plus it`() {
        val keep = CardEdit.keeping("macro", listOf("flowers"))
        assertEquals(CardFieldChange.Tags(listOf("flowers", "macro")), keep)
        assertEquals(mapOf("cardId" to "c", "field" to "tags", "value" to listOf("flowers", "macro")), keep?.args("c"))
        assertNull(CardEdit.keeping("Macro", listOf("macro")))
        assertEquals(
            mapOf("cardId" to "c", "field" to "removeAiTag", "tagToRemove" to "macro"),
            CardFieldChange.RemoveAiTag("macro").args("c"),
        )
    }

    @Test
    fun `suggests Teak tags the card does not have`() {
        val tagged = card.copy(type = CardType.Image, tags = listOf("design"), aiTags = listOf("Design", "Color", " "))
        assertEquals(listOf("Color"), CardEdit.suggestedTags(tagged))
        assertEquals(emptyList(), CardEdit.suggestedTags(card.copy(tags = null, aiTags = null)))
    }

    @Test
    fun `undo after trash restores the card`() {
        assertEquals(mapOf("cardId" to "c", "field" to "delete"), CardFieldChange.MoveToTrash.args("c"))
        assertEquals(mapOf("cardId" to "c", "field" to "restore"), CardFieldChange.Restore.args("c"))
    }

    @Test
    fun `saves a typed link title unless blank or unchanged`() {
        val change = CardEdit.titleChange("  Field notes ", current = "Example")
        assertEquals(CardFieldChange.MetadataTitle("Field notes"), change)
        assertEquals(mapOf("cardId" to "c", "field" to "metadataTitle", "value" to "Field notes"), change?.args("c"))
        assertNull(CardEdit.titleChange("   ", current = "Example"))
        assertNull(CardEdit.titleChange("Example ", current = "Example"))
    }

    @Test
    fun `shows a typed link title before the page's own`() {
        val link = card.copy(
            type = CardType.Link,
            url = "https://example.com",
            metadataTitle = "Typed",
            metadata = CardMetadata(linkPreview = LinkPreview(status = "success", title = "From the page")),
        )
        assertEquals(UiText.verbatim("From the page"), CardSheet.linkTitle(link))
        assertEquals(UiText.verbatim("Typed"), CardSheet.linkTitle(link.copy(metadataTitleEdited = true)))
    }
}

class LinkEditTest {
    private val invalid = UiText.of("native.card.editLink.invalid")

    @Test
    fun `accepts http and https links`() {
        for (input in listOf("https://example.com", "  http://teak.dev/a?b=1#c  ", "HTTPS://Example.com", "https://me@example.com:8080/x", "https://bücher.de")) {
            assertNull(LinkEdit.validationError(input), input)
        }
    }

    @Test
    fun `refuses anything else with the server's message`() {
        for (input in listOf("", "example.com", "ftp://example.com", "javascript:alert(1)", "https://", "https://exa mple.com", "https://:80")) {
            assertEquals(invalid, LinkEdit.validationError(input), input)
            assertNull(LinkEdit.change(input, current = "https://example.com"), input)
        }
    }

    @Test
    fun `saves a new address trimmed`() {
        val change = LinkEdit.change("  https://example.org/new ", current = "https://example.com")
        assertEquals(CardFieldChange.Url("https://example.org/new"), change)
        assertEquals(mapOf("cardId" to "c", "field" to "url", "value" to "https://example.org/new"), change?.args("c"))
        assertNull(LinkEdit.change("https://example.com", current = "https://example.com"))
    }
}

class EmptyTrashTest {
    @Test
    fun `confirmation counts the cards`() {
        assertEquals(UiText.of("native.trash.emptyMessage", count = 1), EmptyTrash.message(1))
        assertEquals(UiText.of("native.trash.emptyMessage", count = 3), EmptyTrash.message(3))
        assertEquals(UiText.of("native.trash.emptyMessageMore", count = 500), EmptyTrash.message(500))
    }

    @Test
    fun `says what the server will delete`() {
        assertEquals(UiText.of("native.trash.emptying", count = 5), EmptyTrash.done(5))
        assertEquals(UiText.of("native.trash.emptyingMore", count = 500), EmptyTrash.done(500))
        assertEquals(UiText.of("native.trash.alreadyEmpty"), EmptyTrash.done(0))
    }

    @Test
    fun `words the server's limit in the app's language`() {
        assertEquals(UiText.of("native.trash.rateLimited"), EmptyTrash.failure("RATE_LIMITED", UiText.verbatim("Trash was emptied…")))
        assertEquals(UiText.verbatim("Offline"), EmptyTrash.failure(null, UiText.verbatim("Offline")))
        assertEquals(UiText.of("native.trash.emptyFailed"), EmptyTrash.failure(null, null))
    }
}
