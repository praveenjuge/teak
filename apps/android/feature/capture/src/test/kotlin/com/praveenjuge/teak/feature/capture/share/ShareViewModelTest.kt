package com.praveenjuge.teak.feature.capture.share

import app.cash.turbine.test
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeUploadRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
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

    private fun viewModel(signedIn: Boolean = true) =
        ShareViewModel(ShareImporter(cards, FakeUploadRepository(), FakeAccountRepository(signedIn)))

    @Test
    fun `a saved share closes the sheet after a moment`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel()
        viewModel.close.test {
            viewModel.start(listOf(ShareItem.Text("hello")))
            runCurrent()
            assertEquals(ShareUiState.Saved, viewModel.uiState.value)

            advanceTimeBy(ShareViewModel.SAVED_DISMISS_MILLIS - 1)
            expectNoEvents()
            advanceTimeBy(2)
            awaitItem()
        }
    }

    @Test
    fun `a signed out share stays open to offer sign in`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel(signedIn = false)
        viewModel.close.test {
            viewModel.start(listOf(ShareItem.Text("hello")))
            advanceTimeBy(10_000)
            assertEquals(ShareUiState.SignInRequired, viewModel.uiState.value)
            expectNoEvents()
        }
    }

    @Test
    fun `a share that arrives while the sheet is open is saved too`() = runTest(mainDispatcher.dispatcher) {
        val viewModel = viewModel()
        viewModel.start(emptyList())
        runCurrent()
        assertEquals(ShareUiState.Empty, viewModel.uiState.value)

        viewModel.startAgain(listOf(ShareItem.Text("second share")))
        runCurrent()
        assertEquals(ShareUiState.Saved, viewModel.uiState.value)
        assertEquals(listOf("second share"), cards.created)
    }
}
