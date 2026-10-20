package com.praveenjuge.teak.feature.capture.share

import androidx.lifecycle.viewModelScope
import app.cash.turbine.test
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeUploadRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals

class ShareViewModelTest {
    @get:Rule val mainDispatcher = MainDispatcherRule(StandardTestDispatcher())

    private val cards = FakeCardsRepository()

    private fun viewModel(appScope: CoroutineScope, signedIn: Boolean = true) =
        ShareViewModel(ShareImporter(cards, FakeUploadRepository(), FakeAccountRepository(signedIn)), cards, appScope)

    @Test
    fun `a saved share closes the sheet after a moment`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel(backgroundScope)
        viewModel.close.test {
            viewModel.start(listOf(ShareItem.Text("hello")))
            runCurrent()
            assertEquals(ShareUiState.Saved(cardId = "new-1"), viewModel.uiState.value)

            advanceTimeBy(ShareViewModel.DETAILS_OFFER_MILLIS - 1)
            expectNoEvents()
            advanceTimeBy(2)
            awaitItem()
        }
    }

    @Test
    fun `a signed out share stays open to offer sign in`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel(backgroundScope, signedIn = false)
        viewModel.close.test {
            viewModel.start(listOf(ShareItem.Text("hello")))
            advanceTimeBy(10_000)
            assertEquals(ShareUiState.SignInRequired, viewModel.uiState.value)
            expectNoEvents()
        }
    }

    @Test
    fun `a share that arrives while the sheet is open is saved too`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel(backgroundScope)
        viewModel.start(emptyList())
        runCurrent()
        assertEquals(ShareUiState.Empty, viewModel.uiState.value)

        viewModel.startAgain(listOf(ShareItem.Text("second share")))
        runCurrent()
        assertEquals(ShareUiState.Saved(cardId = "new-1"), viewModel.uiState.value)
        assertEquals(listOf("second share"), cards.created)
    }

    @Test
    fun `closing the sheet mid-save still saves the share`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel(backgroundScope)
        viewModel.start(listOf(ShareItem.Text("hello")))
        viewModel.viewModelScope.cancel()
        runCurrent()
        assertEquals(listOf("hello"), cards.created)
    }

    @Test
    fun `tags and a note go on the saved card, and the sheet waits for them`() = runTest(mainDispatcher.dispatcher) {
        cards.cards.value = mapOf("new-1" to com.praveenjuge.teak.core.model.Card(id = "new-1", creationTime = 0.0, type = com.praveenjuge.teak.core.model.CardType.Link))
        val viewModel = viewModel(backgroundScope)
        viewModel.close.test {
            viewModel.start(listOf(ShareItem.Text("https://teakvault.com")))
            runCurrent()
            viewModel.addDetails()
            advanceTimeBy(ShareViewModel.DETAILS_OFFER_MILLIS * 2)
            expectNoEvents()

            viewModel.updateTagInput("Secret")
            viewModel.addTag()
            viewModel.updateTagInput("reading")
            viewModel.updateNote("  For the weekend ")
            val details = (viewModel.uiState.value as ShareUiState.Saved).details!!
            assertEquals(listOf("secret"), details.tags)
            assertEquals("Hidden. Search #secret to see it.", details.hiddenHint)

            viewModel.saveDetails()
            runCurrent()
            awaitItem()
        }
        assertEquals(
            listOf(
                "edit:new-1:${com.praveenjuge.teak.core.model.CardFieldChange.Tags(listOf("secret", "reading"))}",
                "edit:new-1:${com.praveenjuge.teak.core.model.CardFieldChange.Notes("For the weekend")}",
            ),
            cards.writes,
        )
    }
}
