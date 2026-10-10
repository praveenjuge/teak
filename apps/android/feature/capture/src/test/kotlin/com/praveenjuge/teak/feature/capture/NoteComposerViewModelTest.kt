package com.praveenjuge.teak.feature.capture

import app.cash.turbine.test
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NoteComposerViewModelTest {
    @get:Rule val mainDispatcher = MainDispatcherRule()

    private val cards = FakeCardsRepository()

    @Test
    fun `saving creates the card and signals the screen to close`() = runTest {
        val viewModel = NoteComposerViewModel(cards)
        viewModel.saved.test {
            viewModel.save("https://example.com")
            awaitItem()
        }
        assertEquals(listOf("https://example.com"), cards.created)
        assertNull(viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isSaving)
    }

    @Test
    fun `blank text is never saved`() = runTest {
        val viewModel = NoteComposerViewModel(cards)
        assertFalse(viewModel.uiState.value.canSave("   \n"))
        viewModel.save("   \n")
        assertTrue(cards.created.isEmpty())
    }

    @Test
    fun `a full card limit shows the server's message`() = runTest {
        cards.createError = TeakException(TeakException.CARD_LIMIT_REACHED, "You've used all 200 cards on Free.")
        val viewModel = NoteComposerViewModel(cards)
        viewModel.save("A note")
        assertEquals(SaveError("Card limit reached", "You've used all 200 cards on Free."), viewModel.uiState.value.error)
        assertTrue(viewModel.uiState.value.canSave("A note"))
    }

    @Test
    fun `any other failure asks to try again`() = runTest {
        cards.createError = IllegalStateException("socket closed")
        val viewModel = NoteComposerViewModel(cards)
        viewModel.saved.test {
            viewModel.save("A note")
            expectNoEvents()
        }
        assertEquals("Failed to save card. Please try again.", viewModel.uiState.value.error?.message)
    }
}
