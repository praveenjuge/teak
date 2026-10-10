package com.praveenjuge.teak.feature.card

import app.cash.turbine.test
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.testing.FakeCardsRepository
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
        files = CardFiles(RuntimeEnvironment.getApplication(), OkHttpClient()),
    )

    /** Holds favorite writes until the test lets them through, like a slow network. */
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
}
