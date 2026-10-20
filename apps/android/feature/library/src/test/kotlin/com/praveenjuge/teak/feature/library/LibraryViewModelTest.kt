package com.praveenjuge.teak.feature.library

import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.FolderKind
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.TimeSearch
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeFoldersRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LibraryViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeCardsRepository()
    private val folders = FakeFoldersRepository()

    private fun summary(id: String) = CardSummary(id = id, creationTime = 0.0, type = CardType.Text, title = "Card $id")

    private fun library(vararg ids: String, folderId: String? = null): LibraryViewModel {
        repository.summaries.value = ids.map(::summary)
        return LibraryViewModel(folderId, repository, folders)
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
        assertEquals("No cards from Jun 5, 2024.", assertIs<LibraryEmptyState.NoMatches>(viewModel.state.value.emptyState).copy.message)
        assertTrue(repository.semanticRequests.isEmpty())
    }

    @Test
    fun `an empty Trash says how long cards stay`() = runTest {
        val viewModel = library()
        viewModel.toggleTrash()
        advanceUntilIdle()

        assertEquals("Trash Is Empty", assertIs<LibraryEmptyState.NoMatches>(viewModel.state.value.emptyState).copy.title)
        assertEquals("Trash", viewModel.state.value.title)
    }

    @Test
    fun `the Archive view asks for archived cards and can't be revisited`() = runTest {
        val viewModel = library("a")
        viewModel.toggleArchive()
        advanceUntilIdle()

        assertTrue(repository.queries.last().filters.archivedOnly)
        assertEquals("Archive", viewModel.state.value.title)
        assertFalse(viewModel.state.value.canRevisit)
    }

    @Test
    fun `each shuffle asks for a fresh order`() = runTest {
        val viewModel = library("a")
        viewModel.sort(CardSort.Shuffle)
        advanceUntilIdle()
        val first = repository.queries.last().filters.shuffleSeed
        viewModel.sort(CardSort.Shuffle)
        advanceUntilIdle()

        assertEquals(CardSort.Shuffle, repository.queries.last().filters.sort)
        assertTrue(first != repository.queries.last().filters.shuffleSeed)
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
    fun `bulk actions go through one call and say what failed`() = runTest {
        val viewModel = library("a", "b", "c", "d", "e")
        repository.failingIds = setOf("b", "d")
        viewModel.select("a", "b", "c", "d", "e")

        viewModel.runOnSelected(BulkAction.Delete)
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals(listOf("bulk:delete:a,c,e"), repository.writes)
        assertEquals("Moved 3 cards to Trash. 2 couldn't be changed.", state.message?.text)
        assertEquals(Selection.None, state.selection)
    }

    @Test
    fun `archiving picked cards offers Undo, which unarchives the ones that changed`() = runTest {
        val viewModel = library("a", "b")
        viewModel.select("a", "b")
        viewModel.runOnSelected(BulkAction.Archive)
        advanceUntilIdle()

        val message = viewModel.state.value.message!!
        assertEquals("Archived 2 cards", message.text)
        viewModel.undo(message)
        advanceUntilIdle()

        assertEquals(listOf("bulk:archive:a,b", "bulk:unarchive:a,b"), repository.writes)
        assertNull(viewModel.state.value.message)
    }

    @Test
    fun `tags and folders go to every picked card`() = runTest {
        val viewModel = library("a", "b")
        viewModel.select("a", "b")
        viewModel.runOnSelected(BulkAction.AddTags, tags = listOf("design"))
        advanceUntilIdle()
        assertEquals("Added tags to 2 cards", viewModel.state.value.message?.text)

        viewModel.select("a")
        viewModel.addSelectedToNewFolder("Reading")
        advanceUntilIdle()

        assertEquals(listOf("bulk:addTags:a,b:design", "bulk:addToFolder:a:f1"), repository.writes)
        assertEquals("Added 1 card to Reading", viewModel.state.value.message?.text)
        assertEquals(listOf("Reading"), folders.all.value.map { it.name })
    }

    @Test
    fun `restore in Trash restores each picked card and leaves select mode`() = runTest {
        val viewModel = library("a", "b", "c")
        viewModel.toggleTrash()
        viewModel.select("a", "c")

        viewModel.runOnSelected(BulkAction.Restore)
        advanceUntilIdle()

        assertEquals(listOf("bulk:restore:a,c"), repository.writes)
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
        assertEquals("Deleted 2 cards forever", viewModel.state.value.message?.text)
    }

    @Test
    fun `searches with free words or an anchor also rank by meaning`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("is:archived tag:x")
        advanceUntilIdle()
        assertEquals(emptyList(), repository.semanticRequests)

        viewModel.onSearchChange("cozy chair")
        advanceTimeBy(LibraryViewModel.SEMANTIC_DEBOUNCE_MS - 50)
        assertEquals(emptyList(), repository.semanticRequests)
        advanceUntilIdle()
        viewModel.onSearchChange("like:j979t50bv7gjxz2mazwwf5tes18gbvnt")
        advanceUntilIdle()

        assertEquals(listOf("cozy chair", "like:j979t50bv7gjxz2mazwwf5tes18gbvnt"), repository.semanticRequests)
        assertEquals("ok", viewModel.state.value.semanticOutcome)
    }

    @Test
    fun `a failed meaning search leaves the keyword results alone`() = runTest {
        repository.semanticError = IllegalStateException("offline")
        val viewModel = library("a")
        viewModel.onSearchChange("cozy chair")
        advanceUntilIdle()

        assertEquals("unavailable", viewModel.state.value.semanticOutcome)
        assertEquals(listOf("a"), viewModel.state.value.paged.cards.map { it.id })
        assertNull(viewModel.state.value.message)
    }

    @Test
    fun `typed filters show as chips, with Done and To do as toggles instead`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("is:done is:archived price:<50 lamp")
        advanceUntilIdle()

        val state = viewModel.state.value
        assertTrue(state.showsDone)
        assertEquals(listOf("Archived", "Under 50"), state.chips.map { it.label })
    }

    @Test
    fun `an empty view whose cards are hidden says how to see them`() = runTest {
        repository.hiddenCards = true
        val viewModel = library()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.hasHiddenCards)

        viewModel.onSearchChange("anything")
        advanceUntilIdle()
        assertFalse(viewModel.state.value.hasHiddenCards)
    }

    @Test
    fun `a folder view is titled by its folder and says when it's gone`() = runTest {
        folders.all.value = listOf(Folder(id = "f1", name = "Reading", kind = FolderKind.Manual))
        val viewModel = library(folderId = "f1")
        advanceUntilIdle()
        assertEquals("Reading", viewModel.state.value.title)
        assertEquals("f1", repository.queries.last().folderId)

        folders.all.value = emptyList()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.folderMissing)
    }

    @Test
    fun `a smart folder that saves is-archived is an Archive view`() = runTest {
        folders.all.value = listOf(
            Folder(id = "f1", name = "Old reads", kind = FolderKind.Smart, query = "is:archived type:link"),
            Folder(id = "f2", name = "Links", kind = FolderKind.Smart, query = "type:link"),
        )
        val archived = library(folderId = "f1")
        advanceUntilIdle()
        assertTrue(archived.state.value.isArchive)
        assertFalse(archived.state.value.canRevisit)

        val links = library(folderId = "f2")
        advanceUntilIdle()
        assertFalse(links.state.value.isArchive)
    }
}
