package com.praveenjuge.teak.feature.card

import app.cash.turbine.test
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

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

        assertEquals(EditAlert("Quote is empty", "Write the quote before saving."), viewModel.uiState.value.alert)
        assertEquals(emptyList(), cards.writes)
    }

    @Test
    fun `a failed save keeps the edits and explains`() = runTest {
        val viewModel = viewModel()
        cards.failingIds = setOf(note.id)
        viewModel.updateNotes("New notes")
        viewModel.save()

        assertEquals("Couldn't save changes", viewModel.uiState.value.alert?.title)
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
        assertEquals("Original", state.draft!!.content)
        assertEquals("My edit", state.draft.notes)
    }

    @Test
    fun `a missing card shows as unavailable`() = runTest {
        val viewModel = CardEditViewModel("gone", cards)

        assertFalse(viewModel.uiState.value.isLoading)
        assertNull(viewModel.uiState.value.draft)
    }
}
