package com.praveenjuge.teak.feature.library

import androidx.lifecycle.SavedStateHandle
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.LibraryView
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.FolderKind
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.TimeSearch
import com.praveenjuge.teak.core.model.TrashCount
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeFoldersRepository
import com.praveenjuge.teak.core.testing.FakeLanguageRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.emptyFlow
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
    private val language = FakeLanguageRepository()
    private val account = FakeAccountRepository()

    private fun summary(id: String) = CardSummary(id = id, creationTime = 0.0, type = CardType.Text, title = "Card $id")

    private fun library(
        vararg ids: String,
        folderId: String? = null,
        fixedView: LibraryView? = null,
        savedState: SavedStateHandle = SavedStateHandle(),
    ): LibraryViewModel {
        repository.summaries.value = ids.map(::summary)
        return LibraryViewModel(folderId, fixedView, repository, folders, language, account, savedState)
    }

    private fun LibraryViewModel.select(vararg ids: String) {
        beginSelection()
        ids.forEach(::toggleSelected)
    }

    @Test
    fun `filters come back after the app is ended in the background`() = runTest {
        val savedState = SavedStateHandle()
        val before = library(savedState = savedState)
        before.toggleFavorites()
        before.toggleType(CardType.Link)
        before.sort(CardSort.Oldest)

        val after = library(savedState = SavedStateHandle(savedState.keys().associateWith { savedState.get<Any>(it) }))

        assertEquals(before.state.value.filters, after.state.value.filters)
        assertTrue(after.state.value.filters.favoritesOnly)
    }

    @Test
    fun `date words read in the app's language`() = runTest {
        language.current.value = "fr"
        val viewModel = library()
        viewModel.onSearchChange("monday")
        advanceUntilIdle()
        assertEquals(UiText.verbatim("lundi"), viewModel.state.value.timeFilter?.labelText)
    }

    @Test
    fun `cards kept on screen while Trash loads can't be selected or deleted`() = runTest {
        repository.summaries.value = listOf(summary("a"), summary("b"))
        // Trash never answers here, like a slow first page on a bad connection.
        val slowTrash = object : CardsRepository by repository {
            override fun page(query: CardQuery, cursor: String?, numItems: Int) =
                if (query.filters.trashOnly) emptyFlow() else repository.page(query, cursor, numItems)

            override fun trashCount() = emptyFlow<Result<TrashCount>>()
        }
        val viewModel = LibraryViewModel(null, null, slowTrash, folders, language, account, SavedStateHandle())
        advanceUntilIdle()
        viewModel.toggleTrash()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals(listOf("a", "b"), state.paged.cards.map { it.id })
        assertFalse(state.canActOnCards)
        assertFalse(state.canEmptyTrash)
        viewModel.select("a")
        assertFalse(viewModel.state.value.isSelecting)
        viewModel.deleteSelectedForever()
        assertTrue(repository.writes.isEmpty())
    }

    @Test
    fun `cards stay usable during a pull to refresh, not after switching views`() = runTest {
        repository.summaries.value = listOf(summary("a"))
        var answered = false
        // Only the first page ever answers, so the refresh and the new view both stay loading.
        val slowAfterFirst = object : CardsRepository by repository {
            override fun page(query: CardQuery, cursor: String?, numItems: Int) =
                if (answered) emptyFlow() else repository.page(query, cursor, numItems).also { answered = true }
        }
        val viewModel = LibraryViewModel(null, null, slowAfterFirst, folders, language, account, SavedStateHandle())
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.paged.isRefreshing)
        assertTrue(viewModel.state.value.canActOnCards)

        viewModel.toggleTrash()
        advanceUntilIdle()
        assertFalse(viewModel.state.value.canActOnCards)

        // A pull to refresh before Trash answers still shows Home's cards, so they stay out of reach.
        viewModel.refresh()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.paged.isRefreshing)
        assertFalse(viewModel.state.value.canActOnCards)
        viewModel.select("a")
        assertFalse(viewModel.state.value.isSelecting)
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
    fun `the tablet's Trash page keeps its filter`() = runTest {
        val viewModel = library(fixedView = LibraryView.Trash)
        advanceUntilIdle()
        assertEquals(LibraryFilters(trashOnly = true), repository.queries.last().filters)
        assertFalse(viewModel.state.value.canClearFilters)

        viewModel.toggleTrash()
        viewModel.toggleArchive()
        viewModel.toggleType(CardType.Link)
        advanceUntilIdle()
        assertEquals(LibraryFilters(trashOnly = true, types = listOf(CardType.Link)), viewModel.state.value.filters)
        assertTrue(viewModel.state.value.canClearFilters)

        viewModel.clearFilters()
        assertEquals(LibraryFilters(trashOnly = true), viewModel.state.value.filters)
        assertEquals(UiText.of("native.filters.trash"), viewModel.state.value.title)
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
        assertEquals(
            UiText.of("native.filters.empty.noCardsFrom"),
            assertIs<LibraryEmptyState.NoMatches>(viewModel.state.value.emptyState).copy.message,
        )
        assertTrue(repository.semanticRequests.isEmpty())
    }

    @Test
    fun `a date word beside other words filters by date and keeps the words`() = runTest {
        val viewModel = library()
        viewModel.onSearchChange("figma last week")
        advanceUntilIdle()

        val query = repository.queries.last()
        assertEquals("figma", query.search)
        assertEquals(TimeSearch.parse("last week")?.range, query.range)
        assertEquals("figma", viewModel.state.value.revisitQuery.search)
        assertEquals(query.range, viewModel.state.value.revisitQuery.range)
    }

    @Test
    fun `search text with operators is sent as typed`() = runTest {
        val viewModel = library()
        for (text in listOf("design -figma", "tag:fonts OR tag:type", "(site:github.com OR site:gitlab.com) -is:archived")) {
            viewModel.onSearchChange(text)
            advanceUntilIdle()
            assertEquals(CardQuery(search = text), repository.queries.last(), text)
            assertTrue(viewModel.state.value.chips("").isEmpty(), text)
        }
    }

    @Test
    fun `an empty Trash says how long cards stay`() = runTest {
        val viewModel = library()
        viewModel.toggleTrash()
        advanceUntilIdle()

        assertEquals(UiText.of("native.filters.empty.trashTitle"), assertIs<LibraryEmptyState.NoMatches>(viewModel.state.value.emptyState).copy.title)
        assertEquals(UiText.of("native.filters.trash"), viewModel.state.value.title)
    }

    @Test
    fun `the Archive view asks for archived cards and can't be revisited`() = runTest {
        val viewModel = library("a")
        viewModel.toggleArchive()
        advanceUntilIdle()

        assertTrue(repository.queries.last().filters.archivedOnly)
        assertEquals(UiText.of("native.filters.archive"), viewModel.state.value.title)
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
        assertEquals(UiText.of("native.library.selectCards"), viewModel.state.value.title)

        viewModel.toggleSelected("a")
        viewModel.toggleSelected("b")
        assertEquals(UiText.of("native.library.selectedCount", count = 2), viewModel.state.value.title)

        viewModel.endSelection()
        assertEquals(UiText.of("native.filters.home"), viewModel.state.value.title)
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
        assertEquals(UiText.of("native.bulk.partial", UiText.of("native.bulk.done.delete", count = 3), count = 2), state.message?.text)
        assertEquals(Selection.None, state.selection)
    }

    @Test
    fun `archiving picked cards offers Undo, which unarchives the ones that changed`() = runTest {
        val viewModel = library("a", "b")
        viewModel.select("a", "b")
        viewModel.runOnSelected(BulkAction.Archive)
        advanceUntilIdle()

        val message = viewModel.state.value.message!!
        assertEquals(UiText.of("native.bulk.done.archive", count = 2), message.text)
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
        assertEquals(UiText.of("native.bulk.done.addTags", count = 2), viewModel.state.value.message?.text)

        viewModel.select("a")
        viewModel.addSelectedToNewFolder("Reading")
        advanceUntilIdle()

        assertEquals(listOf("bulk:addTags:a,b:design", "bulk:addToFolder:a:f1"), repository.writes)
        assertEquals(UiText.of("native.bulk.done.addToFolder", "Reading", count = 1), viewModel.state.value.message?.text)
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
        assertEquals(UiText.of("native.bulk.done.deleteForever", count = 2), viewModel.state.value.message?.text)
    }

    @Test
    fun `empty trash counts every card in Trash, empties them and says so`() = runTest {
        repository.hiddenTrashCount = 2
        val viewModel = library("a", "b", "c")
        advanceUntilIdle()
        assertFalse(viewModel.state.value.canEmptyTrash)
        assertNull(viewModel.state.value.trashCount)
        viewModel.toggleTrash()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.canEmptyTrash)
        assertEquals(UiText.of("native.trash.emptyMessage", count = 5), viewModel.state.value.emptyTrashMessage)

        viewModel.emptyTrash()
        advanceUntilIdle()

        assertEquals(listOf("emptyTrash"), repository.writes)
        assertEquals(UiText.of("native.trash.emptying", count = 5), viewModel.state.value.message?.text)
        assertEquals(emptyList(), viewModel.state.value.paged.cards)
        assertEquals(0, viewModel.state.value.trashCount?.cardCount)
        assertFalse(viewModel.state.value.canEmptyTrash)
    }

    @Test
    fun `only hidden cards in Trash can still be emptied`() = runTest {
        repository.hiddenTrashCount = 1
        val viewModel = library()
        viewModel.toggleTrash()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.canEmptyTrash)
    }

    @Test
    fun `a failed empty trash keeps the cards and says why`() = runTest {
        repository.emptyTrashError = IllegalStateException("offline")
        val viewModel = library("a")
        viewModel.toggleTrash()
        advanceUntilIdle()

        viewModel.emptyTrash()
        advanceUntilIdle()
        assertEquals(UiText.of("native.trash.emptyFailed"), viewModel.state.value.message?.text)
        assertEquals(listOf("a"), viewModel.state.value.paged.cards.map { it.id })
        assertTrue(viewModel.state.value.canEmptyTrash)

        repository.emptyTrashError = TeakException("RATE_LIMITED", "Trash was emptied a few times just now. Try again in a minute.")
        viewModel.emptyTrash()
        advanceUntilIdle()
        assertEquals(UiText.of("native.trash.rateLimited"), viewModel.state.value.message?.text)
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
        assertEquals(
            listOf(UiText.of("native.filters.is.archived"), UiText.of("native.filters.price.under", "50")),
            state.chips(unavailableCard = "unavailable card").map { it.labelText },
        )
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
        assertEquals(UiText.verbatim("Reading"), viewModel.state.value.title)
        assertEquals("f1", repository.queries.last().folderId)

        folders.all.value = emptyList()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.folderMissing)
    }

    @Test
    fun `a smart folder that saves a like search ranks by meaning with nothing typed`() = runTest {
        folders.all.value = listOf(
            Folder(id = "f1", name = "Like this", kind = FolderKind.Smart, query = "like:j979t50bv7gjxz2mazwwf5tes18gbvnt"),
        )
        library(folderId = "f1")
        advanceUntilIdle()
        assertEquals(listOf(""), repository.semanticRequests)
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
