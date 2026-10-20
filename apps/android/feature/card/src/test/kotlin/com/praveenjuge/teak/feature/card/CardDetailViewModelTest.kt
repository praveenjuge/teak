package com.praveenjuge.teak.feature.card

import app.cash.turbine.test
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardMetadata
import com.praveenjuge.teak.core.model.LinkCategory
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeFoldersRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CardDetailViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    private val cards = FakeCardsRepository()
    private val card = Card(id = "c1", creationTime = 0.0, type = CardType.Text, content = "Hello")

    private fun viewModel(repository: CardsRepository = cards) = CardDetailViewModel(
        cardId = card.id,
        repository = repository,
        folders = folders,
        files = CardFiles(RuntimeEnvironment.getApplication(), OkHttpClient()),
    )

    private val folders = FakeFoldersRepository()
    private val link = Card(
        id = "l1",
        creationTime = 0.0,
        type = CardType.Link,
        url = "https://example.com",
        metadata = CardMetadata(linkCategory = LinkCategory(category = "article")),
    )

    private fun linkViewModel(repository: CardsRepository = cards) = CardDetailViewModel(
        cardId = link.id,
        repository = repository,
        folders = folders,
        files = CardFiles(RuntimeEnvironment.getApplication(), OkHttpClient()),
    )

    private class SlowFavorites(private val fake: FakeCardsRepository) : CardsRepository by fake {
        val release = CompletableDeferred<Unit>()
        override suspend fun setFavorite(id: String, favorite: Boolean) {
            release.await()
            fake.setFavorite(id, favorite)
        }
    }

    @Test
    fun `favoriting shows right away and settles once the card catches up`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        val repository = SlowFavorites(cards)
        val viewModel = viewModel(repository)

        viewModel.toggleFavorite()
        assertTrue(viewModel.uiState.value.isFavorited)
        assertEquals(emptyList(), cards.writes)

        repository.release.complete(Unit)
        assertEquals(listOf("favorite:c1:true"), cards.writes)
        assertTrue(viewModel.uiState.value.isFavorited)
        assertNull(viewModel.uiState.value.favoriteOverride)
    }

    @Test
    fun `a failed favorite reverts and says so`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        cards.failingIds = setOf(card.id)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.toggleFavorite()
            assertEquals(CardDetailEvent.Message("Couldn't update this favorite."), awaitItem())
        }
        assertFalse(viewModel.uiState.value.isFavorited)
    }

    @Test
    fun `moving to trash closes the card`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.moveToTrash()
            assertEquals(CardDetailEvent.Close, awaitItem())
        }
        assertEquals(listOf("trash:c1"), cards.writes)
        assertTrue(viewModel.uiState.value.card!!.deleted)
    }

    @Test
    fun `a failed move to trash keeps the card open with an error`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        cards.failingIds = setOf(card.id)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.moveToTrash()
            assertEquals(CardDetailEvent.Message("Couldn't delete this card."), awaitItem())
        }
        assertFalse(viewModel.uiState.value.card!!.deleted)
    }

    @Test
    fun `restoring a trashed card brings it back and closes it`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(isDeleted = true))
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.restore()
            assertEquals(CardDetailEvent.Close, awaitItem())
        }
        assertEquals(listOf("restore:c1"), cards.writes)
        assertFalse(viewModel.uiState.value.card!!.deleted)
    }

    @Test
    fun `a failed restore says so`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(isDeleted = true))
        cards.failingIds = setOf(card.id)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.restore()
            assertEquals(CardDetailEvent.Message("Couldn't restore this card."), awaitItem())
        }
    }

    @Test
    fun `deleting forever removes the card and closes it`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(isDeleted = true))
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.deleteForever()
            assertEquals(CardDetailEvent.Close, awaitItem())
        }
        assertEquals(listOf("deleteForever:c1"), cards.writes)
        assertNull(viewModel.uiState.value.card)
    }

    @Test
    fun `a missing card finishes loading as unavailable`() = runTest {
        val viewModel = viewModel()

        assertFalse(viewModel.uiState.value.isLoading)
        assertNull(viewModel.uiState.value.card)
    }

    @Test
    fun `marking a link done shows at once with its verb, and Undo takes it back`() = runTest {
        cards.cards.value = mapOf(link.id to link)
        val viewModel = linkViewModel()
        assertEquals("Mark as read", viewModel.uiState.value.doneLabel)

        viewModel.events.test {
            viewModel.toggleDone()
            assertTrue(viewModel.uiState.value.isDone)
            assertEquals("Read", viewModel.uiState.value.doneLabel)
            val note = awaitItem() as CardDetailEvent.Message
            assertEquals("Marked as read", note.text)
            note.undo!!.invoke()
            assertFalse(viewModel.uiState.value.isDone)
        }
        assertEquals(listOf("done:l1", "undone:l1"), cards.writes)
    }

    @Test
    fun `a failed done change rolls back`() = runTest {
        cards.cards.value = mapOf(link.id to link)
        cards.failingIds = setOf(link.id)
        val viewModel = linkViewModel()
        viewModel.events.test {
            viewModel.toggleDone()
            assertEquals(CardDetailEvent.Message("Couldn't update. Try again."), awaitItem())
        }
        assertFalse(viewModel.uiState.value.isDone)
    }

    @Test
    fun `only live links can be marked done`() = runTest {
        cards.cards.value = mapOf(card.id to card, link.id to link.copy(isDeleted = true))
        assertFalse(viewModel().uiState.value.canMarkDone)
        assertFalse(linkViewModel().uiState.value.canMarkDone)
    }

    @Test
    fun `refresh details reports the server's refusal`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        cards.refreshOutcome = RefreshOutcome.Refused("This card is already refreshing. Try again in a minute.")
        val viewModel = viewModel()
        viewModel.events.test {
            viewModel.refreshDetails()
            assertEquals(CardDetailEvent.Message("This card is already refreshing. Try again in a minute."), awaitItem())
            cards.refreshOutcome = RefreshOutcome.Queued
            viewModel.refreshDetails()
            assertEquals(CardDetailEvent.Message("Refreshing details. The summary and tags update shortly."), awaitItem())
        }
        assertFalse(viewModel.uiState.value.isRefreshing)
    }

    @Test
    fun `archiving offers Undo`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        val viewModel = viewModel()
        viewModel.events.test {
            viewModel.toggleArchived()
            val note = awaitItem() as CardDetailEvent.Message
            assertEquals("Archived 1 card", note.text)
            note.undo!!.invoke()
        }
        assertEquals(listOf("archive:c1", "unarchive:c1"), cards.writes)
    }

    @Test
    fun `a failed Undo says so and keeps the change it couldn't take back`() = runTest {
        cards.cards.value = mapOf(card.id to card, link.id to link)
        val linkModel = linkViewModel()
        linkModel.events.test {
            linkModel.toggleDone()
            val note = awaitItem() as CardDetailEvent.Message
            cards.failingIds = setOf(link.id)
            note.undo!!.invoke()
            assertEquals(CardDetailEvent.Message("Couldn't undo. Try again."), awaitItem())
        }
        assertTrue(linkModel.uiState.value.isDone)

        val cardModel = viewModel()
        cardModel.events.test {
            cardModel.toggleArchived()
            val note = awaitItem() as CardDetailEvent.Message
            cards.failingIds = setOf(card.id)
            note.undo!!.invoke()
            assertEquals(CardDetailEvent.Message("Couldn't undo. Try again."), awaitItem())
        }
    }

    @Test
    fun `link titles load once per set of linked cards, with backlinks`() = runTest {
        val target = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"
        cards.cards.value = mapOf(card.id to card.copy(content = "See [[Old title|teak:$target]]"))
        cards.linkTargets = listOf(CardLinkTarget(target, missing = false, title = "New title"))
        cards.backlinks = CardBacklinks(listOf(LinkedCard("b1", "Plan", CardType.Text)), hasMore = false)
        val viewModel = viewModel()

        assertEquals("New title", viewModel.uiState.value.linkTargets[target]?.title)
        assertEquals(listOf("Plan"), viewModel.uiState.value.backlinks.backlinks.map { it.title })
        cards.cards.value = mapOf(card.id to card.copy(content = "See [[Old title|teak:$target]] again", notes = "x"))
        assertEquals(listOf(listOf(target)), cards.linkTargetRequests)
    }
}
