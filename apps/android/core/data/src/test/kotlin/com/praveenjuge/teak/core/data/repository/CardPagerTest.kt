package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.BulkResult
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.SimilarAnchor
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.TrashCount
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class CardPagerTest {
    private class DeployedRepository : CardsRepository {
        val cursors = mutableListOf<String?>()
        private var failedOnce = false

        override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
            cursors += cursor
            if (cursor == null) {
                return flowOf(Result.success(CardSummaryPage(listOf(Card1), isDone = false, continueCursor = "c1")))
            }
            if (!failedOnce) {
                failedOnce = true
                return flowOf(Result.failure(IllegalStateException("[CONVEX Q(cards:searchMobileCardSummariesPaginated)] InvalidCursor")))
            }
            return flowOf(Result.success(CardSummaryPage(listOf(Card2), isDone = true)))
        }

        override fun card(id: String): Flow<Result<Card?>> = error("unused")
        override suspend fun setFavorite(id: String, favorite: Boolean) = error("unused")
        override suspend fun moveToTrash(id: String) = error("unused")
        override suspend fun restore(id: String) = error("unused")
        override suspend fun deleteForever(id: String) = error("unused")
        override suspend fun emptyTrash(): TrashCount = error("unused")
        override fun trashCount(): Flow<Result<TrashCount>> = error("unused")
        override suspend fun apply(id: String, changes: List<CardFieldChange>) = error("unused")
        override suspend fun createFromText(text: String): String? = error("unused")
        override val keptOffline: Flow<Set<String>> get() = error("unused")
        override suspend fun keepOffline(card: Card) = error("unused")
        override suspend fun removeOfflineCopy(id: String) = error("unused")
        override fun offlineFile(id: String): java.io.File? = error("unused")
        override val offlineChanges: Flow<Long> get() = error("unused")
        override suspend fun setArchived(id: String, archived: Boolean) = error("unused")
        override suspend fun setDone(id: String, done: Boolean) = error("unused")
        override suspend fun bulk(action: BulkAction, ids: List<String>, tags: List<String>, folderId: String?): BulkResult = error("unused")
        override suspend fun refresh(id: String): RefreshOutcome = error("unused")
        override fun linkTargets(ids: List<String>): Flow<Result<List<CardLinkTarget>>> = error("unused")
        override fun backlinks(id: String): Flow<Result<CardBacklinks>> = error("unused")
        override fun linkSuggestions(query: String, excludeCardId: String): Flow<Result<List<LinkedCard>>> = error("unused")
        override fun similarAnchor(id: String): Flow<Result<SimilarAnchor>> = error("unused")
        override fun viewHasHiddenCards(view: LibraryView, folderId: String?): Flow<Result<Boolean>> = error("unused")
        override suspend fun requestSemanticResults(search: String, folderId: String?): String = error("unused")

        companion object {
            val Card1 = CardSummary(id = "card_1", creationTime = 0.0, type = CardType.Text, title = "One")
            val Card2 = CardSummary(id = "card_2", creationTime = 0.0, type = CardType.Text, title = "Two")
        }
    }

    @Test
    fun `an invalid cursor after a deploy restarts from the first page instead of showing an error`() =
        runTest(UnconfinedTestDispatcher()) {
            val repository = DeployedRepository()
            val pager = CardPager(repository, backgroundScope)

            pager.load(CardQuery())
            pager.loadMore()

            val state = pager.state.value
            assertNull(state.error)
            assertEquals(listOf("card_1"), state.cards.map { it.id })
            assertEquals(listOf(null, "c1", null), repository.cursors)
        }

    @Test
    fun `a cursor that keeps failing shows its error instead of restarting again`() =
        runTest(UnconfinedTestDispatcher()) {
            val alwaysInvalid = object : CardsRepository by DeployedRepository() {
                val cursors = mutableListOf<String?>()

                override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
                    cursors += cursor
                    return flowOf(
                        if (cursor == null) {
                            Result.success(CardSummaryPage(listOf(DeployedRepository.Card1), isDone = false, continueCursor = "c1"))
                        } else {
                            Result.failure(IllegalStateException("InvalidCursor"))
                        },
                    )
                }
            }
            val pager = CardPager(alwaysInvalid, backgroundScope)

            pager.load(CardQuery())
            pager.loadMore()
            pager.loadMore()

            assertEquals("InvalidCursor", pager.state.value.error?.message)
            assertEquals(listOf(null, "c1", null, "c1"), alwaysInvalid.cursors)
        }

    @Test
    fun `retry asks again for the page that failed and keeps the ones before it`() = runTest(UnconfinedTestDispatcher()) {
        val flaky = object : CardsRepository by DeployedRepository() {
            val cursors = mutableListOf<String?>()
            var offline = true

            override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
                cursors += cursor
                return flowOf(
                    when {
                        cursor == null -> Result.success(CardSummaryPage(listOf(DeployedRepository.Card1), isDone = false, continueCursor = "c1"))
                        offline -> Result.failure(IllegalStateException("Network is unreachable"))
                        else -> Result.success(CardSummaryPage(listOf(DeployedRepository.Card2), isDone = true))
                    },
                )
            }
        }
        val pager = CardPager(flaky, backgroundScope)

        pager.load(CardQuery())
        pager.loadMore()
        assertEquals("Network is unreachable", pager.state.value.error?.message)

        flaky.offline = false
        pager.retry()

        assertNull(pager.state.value.error)
        assertEquals(listOf("card_1", "card_2"), pager.state.value.cards.map { it.id })
        assertEquals(listOf(null, "c1", "c1"), flaky.cursors)
    }

    @Test
    fun `a new search keeps showing the last cards until its first page comes`() = runTest(UnconfinedTestDispatcher()) {
        val pages = MutableSharedFlow<Result<CardSummaryPage>>()
        val slow = object : CardsRepository by DeployedRepository() {
            override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> =
                if (query.search.isEmpty()) {
                    flowOf(Result.success(CardSummaryPage(listOf(DeployedRepository.Card1), isDone = true)))
                } else {
                    pages
                }
        }
        val pager = CardPager(slow, backgroundScope)

        pager.load(CardQuery())
        pager.load(CardQuery(search = "two"))
        assertTrue(pager.state.value.isLoading)
        assertEquals(listOf("card_1"), pager.state.value.cards.map { it.id })

        assertTrue(pager.state.value.showsOtherQuery)
        // Refreshing before the new search answers doesn't make the old cards its own.
        pager.refresh()
        assertTrue(pager.state.value.showsOtherQuery)

        pages.emit(Result.success(CardSummaryPage(listOf(DeployedRepository.Card2), isDone = true)))
        assertFalse(pager.state.value.isLoading)
        assertFalse(pager.state.value.showsOtherQuery)
        assertEquals(listOf("card_2"), pager.state.value.cards.map { it.id })
    }

    @Test
    fun `other page errors are still shown`() = runTest(UnconfinedTestDispatcher()) {
        val failing = object : CardsRepository by DeployedRepository() {
            override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> =
                flowOf(Result.failure(IllegalStateException("Network is unreachable")))
        }
        val pager = CardPager(failing, backgroundScope)

        pager.load(CardQuery())

        assertEquals("Network is unreachable", pager.state.value.error?.message)
    }
}
