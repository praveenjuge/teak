package com.praveenjuge.teak.feature.card

import app.cash.turbine.test
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CardEditViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    private val cards = FakeCardsRepository()
    private val note = Card(
        id = "c1",
        creationTime = 0.0,
        type = CardType.Text,
        content = "Original",
        notes = "Old notes",
        tags = listOf("keep"),
        aiTags = listOf("design", "color"),
    )

    private fun viewModel(card: Card = note): CardEditViewModel {
        cards.cards.value = mapOf(card.id to card)
        return CardEditViewModel(card.id, cards)
    }

    @Test
    fun `saving sends only the changed fields in order, then finishes`() = runTest {
        val viewModel = viewModel()
        viewModel.updateContent("Rewritten")
        viewModel.updateNewTag("  New ")
        viewModel.addTag()
        viewModel.removeAiTag("color")

        viewModel.done.test {
            viewModel.save()
            awaitItem()
        }
        assertEquals(
            listOf(
                "edit:c1:Content(value=Rewritten)",
                "edit:c1:Tags(value=[keep, new])",
                "edit:c1:RemoveAiTag(tag=color)",
            ),
            cards.writes,
        )
    }

    @Test
    fun `a failed subscription keeps the card and the draft`() = runTest {
        val results = MutableStateFlow(Result.success<Card?>(note))
        val viewModel = CardEditViewModel(note.id, object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = results
        })
        viewModel.updateNotes("New notes")

        results.value = Result.failure(IllegalStateException("Connection lost"))

        assertEquals(note, viewModel.uiState.value.card)
        assertEquals("New notes", viewModel.uiState.value.draft?.notes)
        assertTrue(viewModel.uiState.value.canSave)
        assertFalse(viewModel.uiState.value.loadFailed)
    }

    @Test
    fun `a card that never loads shows an error, not a deleted card`() = runTest {
        val viewModel = CardEditViewModel(note.id, object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = flowOf(Result.failure(IllegalStateException("Connection lost")))
        })

        assertFalse(viewModel.uiState.value.isLoading)
        assertNull(viewModel.uiState.value.card)
        assertTrue(viewModel.uiState.value.loadFailed)
    }

    @Test
    fun `save is unavailable until something changes`() = runTest {
        val viewModel = viewModel()

        assertFalse(viewModel.uiState.value.canSave)
        viewModel.save()
        assertEquals(emptyList(), cards.writes)
    }

    @Test
    fun `adding a tag already on the card doesn't duplicate it`() = runTest {
        val viewModel = viewModel()
        viewModel.updateNewTag("KEEP")
        viewModel.addTag()

        assertEquals(listOf("keep"), viewModel.uiState.value.draft!!.tags)
        assertEquals("", viewModel.uiState.value.newTag)
    }

    @Test
    fun `an empty quote can't be saved`() = runTest {
        val viewModel = viewModel(note.copy(type = CardType.Quote, content = "To be"))
        viewModel.updateContent("   ")
        viewModel.save()

        assertEquals(EditAlert(UiText.of("native.card.edit.quoteEmptyTitle"), UiText.of("native.card.edit.quoteEmptyMessage")), viewModel.uiState.value.alert)
        assertEquals(emptyList(), cards.writes)
    }

    @Test
    fun `a failed save keeps the edits and explains`() = runTest {
        val viewModel = viewModel()
        cards.failingIds = setOf(note.id)
        viewModel.updateNotes("New notes")
        viewModel.save()

        assertEquals(UiText.of("native.card.edit.saveFailed"), viewModel.uiState.value.alert?.title)
        assertEquals("New notes", viewModel.uiState.value.draft!!.notes)
        assertFalse(viewModel.uiState.value.isSaving)
    }

    @Test
    fun `the draft is seeded once and survives the card changing elsewhere`() = runTest {
        val viewModel = viewModel()
        viewModel.updateNotes("My edit")

        cards.cards.value = mapOf(note.id to note.copy(content = "Changed on the web", notes = "Server notes"))

        val state = viewModel.uiState.value
        assertEquals("Changed on the web", state.card!!.content)
        assertEquals("Original", state.draft!!.editableContent)
        assertEquals("My edit", state.draft.notes)
    }

    @Test
    fun `a missing card shows as unavailable`() = runTest {
        val viewModel = CardEditViewModel("gone", cards)

        assertFalse(viewModel.uiState.value.isLoading)
        assertNull(viewModel.uiState.value.draft)
    }

    @Test
    fun `adding a hidden tag says how to find the card again`() = runTest {
        val viewModel = viewModel()
        viewModel.updateNewTag("Secret")
        viewModel.addTag()
        assertEquals(UiText.of("native.tags.card.hiddenAdded", "secret"), viewModel.uiState.value.hiddenHint)

        viewModel.removeTag("secret")
        assertNull(viewModel.uiState.value.hiddenHint)
    }

    @Test
    fun `typing double brackets in a note finds cards and picking one links it`() = runTest {
        val roadMap = LinkedCard(id = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b", title = "Road map", type = CardType.Link)
        cards.linkableCards = listOf(roadMap, LinkedCard(id = note.id, title = "Road notes", type = CardType.Text))
        val viewModel = viewModel()

        viewModel.updateContent("See [[road and more", cursor = 10)
        assertTrue(viewModel.uiState.value.linkPicker!!.isLoading)
        advanceUntilIdle()
        assertEquals(listOf("road"), cards.linkSuggestionQueries)
        assertEquals(listOf(roadMap), viewModel.uiState.value.linkPicker!!.cards)

        viewModel.pickLink(roadMap)
        val linked = "See [[Road map|teak:${roadMap.id}]] and more"
        val state = viewModel.uiState.value
        assertNull(state.linkPicker)
        assertEquals(linked, state.draft!!.editableContent)
        assertEquals(linked.indexOf(" and more"), state.contentCursor)

        viewModel.done.test {
            viewModel.save()
            awaitItem()
        }
        assertEquals(listOf("edit:c1:Content(value=$linked)"), cards.writes)
    }

    @Test
    fun `a closed picker stays closed until its double brackets go`() = runTest {
        val viewModel = viewModel()
        viewModel.updateContent("[[ro", cursor = 4)
        assertNotNull(viewModel.uiState.value.linkPicker)

        viewModel.dismissLinkPicker()
        viewModel.updateContent("[[roa", cursor = 5)
        assertNull(viewModel.uiState.value.linkPicker)

        viewModel.updateContent("[", cursor = 1)
        viewModel.updateContent("[[", cursor = 2)
        assertNotNull(viewModel.uiState.value.linkPicker)

        viewModel.updateContent("[[x]]", cursor = 5)
        assertNull(viewModel.uiState.value.linkPicker)
    }

    @Test
    fun `a failed card search says so, and quotes get no picker`() = runTest {
        cards.linkSuggestionError = IllegalStateException("offline")
        val viewModel = viewModel()
        viewModel.updateContent("[[", cursor = 2)
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.linkPicker!!.failed)

        val quote = viewModel(note.copy(id = "q1", type = CardType.Quote))
        quote.updateContent("[[", cursor = 2)
        assertNull(quote.uiState.value.linkPicker)
    }

    @Test
    fun `a card that's already hidden gets no hint`() = runTest {
        val viewModel = viewModel(note.copy(tags = listOf("hidden")))
        viewModel.updateNewTag("secret")
        viewModel.addTag()
        assertNull(viewModel.uiState.value.hiddenHint)
    }
}
