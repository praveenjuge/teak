package com.praveenjuge.teak.feature.library

import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.TimeSearch
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class LibraryViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeCardsRepository()

    private fun summary(id: String) = CardSummary(id = id, creationTime = 0.0, type = CardType.Text, title = "Card $id")

    private fun library(vararg ids: String): LibraryViewModel {
        repository.summaries.value = ids.map(::summary)
        return LibraryViewModel(repository)
    }

    private fun LibraryViewModel.select(vararg ids: String) {
        beginSelection()
        ids.forEach(::toggleSelected)
    }

    @Test
    fun `search text and chips combine into one query`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("design")
        viewModel.toggleFavorites()
        viewModel.toggleType(CardType.Link)
        advanceUntilIdle()

        assertEquals(
            CardQuery(search = "design", filters = LibraryFilters(favoritesOnly = true, types = listOf(CardType.Link))),
            repository.queries.last(),
        )
    }

    @Test
    fun `search waits for a pause in typing`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("de")
        advanceTimeBy(100)
        viewModel.onSearchChange("design")
        advanceTimeBy(LibraryViewModel.SEARCH_DEBOUNCE_MS + 1)

        assertEquals(listOf("", "design"), repository.queries.map { it.search })
    }

    @Test
    fun `a date search filters by when cards were saved and drops the text`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("2024-06-05")
        advanceUntilIdle()

        val query = repository.queries.last()
        assertEquals("", query.search)
        assertEquals(TimeSearch.parse("2024-06-05")?.range, query.range)
        assertEquals("No cards from Jun 5, 2024.", viewModel.state.value.emptyCopy?.message)
    }

    @Test
    fun `an empty Trash says how long cards stay`() = runTest {
        val viewModel = library()
        viewModel.toggleTrash()
        advanceUntilIdle()

        assertEquals("Trash Is Empty", viewModel.state.value.emptyCopy?.title)
        assertEquals("Trash", viewModel.state.value.title)
    }

    @Test
    fun `select mode titles count the picked cards`() = runTest {
        val viewModel = library("a", "b")
        viewModel.beginSelection()
        assertEquals("Select Cards", viewModel.state.value.title)

        viewModel.toggleSelected("a")
        viewModel.toggleSelected("b")
        assertEquals("2 Selected", viewModel.state.value.title)

        viewModel.endSelection()
        assertEquals("Home", viewModel.state.value.title)
    }

    @Test
    fun `moving to Trash reports the cards that failed`() = runTest {
        val viewModel = library("a", "b", "c", "d", "e")
        repository.failingIds = setOf("b", "d")
        viewModel.select("a", "b", "c", "d", "e")

        viewModel.moveSelectedToTrash()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals("2 of 5 failed. Please try again.", state.bulkFailure?.message)
        assertEquals(listOf("trash:a", "trash:c", "trash:e"), repository.writes)
        assertNull(state.selection)
    }

    @Test
    fun `restore in Trash restores each picked card and leaves select mode`() = runTest {
        val viewModel = library("a", "b", "c")
        viewModel.toggleTrash()
        viewModel.select("a", "c")

        viewModel.restoreSelected()
        advanceUntilIdle()

        assertEquals(listOf("restore:a", "restore:c"), repository.writes)
        assertNull(viewModel.state.value.bulkFailure)
        assertFalse(viewModel.state.value.isSelecting)
    }

    @Test
    fun `delete forever removes the picked cards from the grid`() = runTest {
        val viewModel = library("a", "b", "c")
        viewModel.toggleTrash()
        viewModel.select("a", "b")

        viewModel.deleteSelectedForever()
        advanceUntilIdle()

        assertEquals(listOf("c"), viewModel.state.value.paged.cards.map { it.id })
    }
}
