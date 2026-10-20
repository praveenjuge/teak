package com.praveenjuge.teak.feature.library

import androidx.compose.ui.input.key.Key
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RevisitViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeCardsRepository()

    private fun deck(vararg ids: String): RevisitViewModel {
        repository.summaries.value = ids.map { CardSummary(id = it, creationTime = 0.0, type = CardType.Text, title = it) }
        return RevisitViewModel(repository).apply { start(CardQuery(search = "design")) }
    }

    @Test
    fun `deals a shuffled deck from the current view`() = runTest {
        val viewModel = deck("a", "b")
        advanceUntilIdle()

        val query = repository.queries.last()
        assertEquals("design", query.search)
        assertEquals(CardSort.Shuffle, query.filters.sort)
        assertEquals("1 of 2", viewModel.state.value.progress)
    }

    @Test
    fun `archive takes a card out, keep moves on, and the end counts both`() = runTest {
        val viewModel = deck("a", "b")
        advanceUntilIdle()
        viewModel.archive()
        advanceUntilIdle()
        viewModel.keep()

        val state = viewModel.state.value
        assertTrue(state.isFinished)
        assertEquals("1 archived · 1 kept", state.summary)
        assertEquals(listOf("archive:a"), repository.writes)
    }

    @Test
    fun `undo brings the last archived card back`() = runTest {
        val viewModel = deck("a", "b")
        advanceUntilIdle()
        viewModel.archive()
        advanceUntilIdle()
        viewModel.undo()
        advanceUntilIdle()

        assertEquals("a", viewModel.state.value.current?.id)
        assertEquals(listOf("archive:a", "unarchive:a"), repository.writes)
        assertNull(viewModel.state.value.archivedNote)
    }

    @Test
    fun `a failed archive or undo says so and leaves the deck where it was`() = runTest {
        val viewModel = deck("a", "b")
        advanceUntilIdle()
        viewModel.archive()
        advanceUntilIdle()
        repository.failingIds = setOf("a")
        viewModel.undo()
        advanceUntilIdle()

        assertEquals("b", viewModel.state.value.current?.id)
        assertEquals("Couldn't update this card.", viewModel.state.value.error)
        viewModel.errorShown()

        repository.failingIds = setOf("b")
        viewModel.archive()
        advanceUntilIdle()
        assertEquals("b", viewModel.state.value.current?.id)
        assertEquals("Couldn't update this card.", viewModel.state.value.error)
    }

    @Test
    fun `a short shuffled page reads on until the deck is full`() = runTest {
        val repository = object : CardsRepository by this@RevisitViewModelTest.repository {
            override fun page(query: CardQuery, cursor: String?, numItems: Int) = flowOf(
                Result.success(
                    if (cursor == null) {
                        CardSummaryPage((1..2).map { summary("a$it") }, isDone = false, continueCursor = "next")
                    } else {
                        CardSummaryPage((1..30).map { summary("b$it") }, isDone = false, continueCursor = "more")
                    },
                ),
            )
        }
        val viewModel = RevisitViewModel(repository).apply { start(CardQuery()) }
        advanceUntilIdle()
        assertEquals("1 of 20", viewModel.state.value.progress)
        assertEquals("a1", viewModel.state.value.current?.id)
    }

    private fun summary(id: String) = CardSummary(id = id, creationTime = 0.0, type = CardType.Text, title = id)

    @Test
    fun `an empty view has nothing to revisit`() = runTest {
        val viewModel = deck()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.isEmpty)
    }

    @Test
    fun `keys match the web deck`() {
        assertEquals(RevisitKey.Archive, revisitKeyAction(Key.DirectionLeft))
        assertEquals(RevisitKey.Archive, revisitKeyAction(Key.A))
        assertEquals(RevisitKey.Keep, revisitKeyAction(Key.DirectionRight))
        assertEquals(RevisitKey.Keep, revisitKeyAction(Key.K))
        assertEquals(RevisitKey.Undo, revisitKeyAction(Key.Z))
        assertEquals(RevisitKey.Open, revisitKeyAction(Key.Spacebar))
        assertNull(revisitKeyAction(Key.Q))
    }
}
