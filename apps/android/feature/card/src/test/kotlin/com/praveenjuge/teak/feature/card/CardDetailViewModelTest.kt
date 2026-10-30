package com.praveenjuge.teak.feature.card

import app.cash.turbine.test
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardColor
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.MarkdownListItem
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardMetadata
import com.praveenjuge.teak.core.model.LinkCategory
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeFoldersRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceTimeBy
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
    private val account = FakeAccountRepository()
    private val card = Card(id = "c1", creationTime = 0.0, type = CardType.Text, content = "Hello")

    private fun viewModel(repository: CardsRepository = cards) = CardDetailViewModel(
        cardId = card.id,
        repository = repository,
        folders = folders,
        files = CardFiles(RuntimeEnvironment.getApplication(), OkHttpClient()),
        account = account,
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
        account = account,
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
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.favorite")), awaitItem())
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
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.moveToTrash")), awaitItem())
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
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.restore")), awaitItem())
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
        assertEquals(UiText.of("native.done.markAs.read"), viewModel.uiState.value.doneText)

        viewModel.events.test {
            viewModel.toggleDone()
            assertTrue(viewModel.uiState.value.isDone)
            assertEquals(UiText.of("native.done.state.read"), viewModel.uiState.value.doneText)
            val note = awaitItem() as CardDetailEvent.Message
            assertEquals(UiText.of("native.done.markedAs.read"), note.text)
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
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.update")), awaitItem())
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
            assertEquals(CardDetailEvent.Message(UiText.verbatim("This card is already refreshing. Try again in a minute.")), awaitItem())
            cards.refreshOutcome = RefreshOutcome.Queued
            viewModel.refreshDetails()
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.notice.refreshing")), awaitItem())
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
            assertEquals(UiText.of("native.bulk.done.archive", count = 1), note.text)
            note.undo!!.invoke()
        }
        assertEquals(listOf("archive:c1", "unarchive:c1"), cards.writes)
    }

    private class SlowArchive(private val fake: FakeCardsRepository) : CardsRepository by fake {
        val release = CompletableDeferred<Unit>()
        override suspend fun setArchived(id: String, archived: Boolean) {
            release.await()
            fake.setArchived(id, archived)
        }
    }

    @Test
    fun `archiving again while it saves sends it once`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        val repository = SlowArchive(cards)
        val viewModel = viewModel(repository)
        viewModel.events.test {
            viewModel.toggleArchived()
            viewModel.toggleArchived()
            repository.release.complete(Unit)
            assertEquals(UiText.of("native.bulk.done.archive", count = 1), (awaitItem() as CardDetailEvent.Message).text)
            expectNoEvents()
        }
        assertEquals(listOf("archive:c1"), cards.writes)
    }

    @Test
    fun `a failed subscription keeps the card on screen`() = runTest {
        val results = MutableStateFlow(Result.success<Card?>(card))
        val viewModel = viewModel(object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = results
        })

        results.value = Result.failure(IllegalStateException("Connection lost"))

        assertEquals(card, viewModel.uiState.value.card)
        assertFalse(viewModel.uiState.value.loadFailed)
    }

    @Test
    fun `a card that never loads shows an error, not a deleted card`() = runTest {
        val viewModel = viewModel(object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = flowOf(Result.failure(IllegalStateException("Connection lost")))
        })

        assertFalse(viewModel.uiState.value.isLoading)
        assertNull(viewModel.uiState.value.card)
        assertTrue(viewModel.uiState.value.loadFailed)
    }

    @Test
    fun `a subscription that recovers drops the error`() = runTest {
        val results = MutableStateFlow(Result.failure<Card?>(IllegalStateException("Connection lost")))
        val viewModel = viewModel(object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = results
        })
        assertTrue(viewModel.uiState.value.loadFailed)

        // The server answers again and says the card is gone: that reads as deleted, not as an error.
        results.value = Result.success(null)

        assertFalse(viewModel.uiState.value.loadFailed)
        assertNull(viewModel.uiState.value.card)
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
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.undo")), awaitItem())
        }
        assertTrue(linkModel.uiState.value.isDone)

        val cardModel = viewModel()
        cardModel.events.test {
            cardModel.toggleArchived()
            val note = awaitItem() as CardDetailEvent.Message
            cards.failingIds = setOf(card.id)
            note.undo!!.invoke()
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.failed.undo")), awaitItem())
        }
    }

    private class SlowEdits(private val fake: FakeCardsRepository) : CardsRepository by fake {
        val release = CompletableDeferred<Unit>()
        override suspend fun apply(id: String, changes: List<CardFieldChange>) {
            release.await()
            fake.apply(id, changes)
        }
    }

    private fun task(line: Int, checked: Boolean) = MarkdownListItem(0, "•", "", checked = checked, line = line)

    @Test
    fun `ticking a task shows at once, moves it below the open ones, and saves the note`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(content = "# Today\n- [ ] Milk\n- [ ] Bread"))
        val repository = SlowEdits(cards)
        val viewModel = viewModel(repository)

        viewModel.toggleTask(task(line = 1, checked = false))
        assertEquals("# Today\n- [ ] Bread\n- [x] Milk", viewModel.uiState.value.displayedCard?.content)
        assertEquals(emptyList(), cards.writes)

        repository.release.complete(Unit)
        assertEquals(listOf("edit:c1:${CardFieldChange.Content("# Today\n- [ ] Bread\n- [x] Milk")}"), cards.writes)
        assertNull(viewModel.uiState.value.contentOverride)
        assertEquals("# Today\n- [ ] Bread\n- [x] Milk", viewModel.uiState.value.displayedCard?.content)
    }

    @Test
    fun `a failed tick puts the note back and says so`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(content = "- [ ] Milk\n- [ ] Bread"))
        cards.failingIds = setOf(card.id)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.toggleTask(task(line = 0, checked = false))
            assertEquals(CardDetailEvent.Message(UiText.of("native.notes.taskFailed")), awaitItem())
        }
        assertNull(viewModel.uiState.value.contentOverride)
        assertEquals("- [ ] Milk\n- [ ] Bread", viewModel.uiState.value.displayedCard?.content)
    }

    @Test
    fun `a stale tick or a trashed note changes nothing`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(content = "- [x] Milk"))
        val viewModel = viewModel()
        viewModel.toggleTask(task(line = 0, checked = false))

        cards.cards.value = mapOf(card.id to card.copy(content = "- [ ] Milk", isDeleted = true))
        viewModel.toggleTask(task(line = 0, checked = false))

        assertEquals(emptyList(), cards.writes)
        assertNull(viewModel.uiState.value.contentOverride)
    }

    @Test
    fun `keeping suggested tags builds on each kept tag before the card catches up`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(tags = listOf("flowers"), aiTags = listOf("macro", "petal")))
        val viewModel = viewModel()

        viewModel.keepTag("macro")
        viewModel.keepTag("petal")
        viewModel.keepTag("Macro")

        assertEquals(
            listOf(
                "edit:c1:${CardFieldChange.Tags(listOf("flowers", "macro"))}",
                "edit:c1:${CardFieldChange.Tags(listOf("flowers", "macro", "petal"))}",
            ),
            cards.writes,
        )
        assertEquals(listOf("flowers", "macro", "petal"), viewModel.uiState.value.displayedCard?.tags)
    }

    @Test
    fun `removing a suggested tag uses removeAiTag`() = runTest {
        cards.cards.value = mapOf(card.id to card.copy(aiTags = listOf("macro")))
        viewModel().removeSuggestedTag("macro")
        assertEquals(listOf("edit:c1:${CardFieldChange.RemoveAiTag("macro")}"), cards.writes)
    }

    @Test
    fun `edit link refuses a non-link with the server's words and saves a link`() = runTest {
        cards.cards.value = mapOf(link.id to link)
        val viewModel = linkViewModel()
        viewModel.openEditLink()

        viewModel.saveLink("example.org")
        assertEquals(UiText.of("native.card.editLink.invalid"), viewModel.uiState.value.linkError)
        assertEquals(emptyList(), cards.writes)

        viewModel.events.test {
            viewModel.saveLink(" https://example.org/new ")
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.editLink.saved")), awaitItem())
        }
        assertEquals(listOf("edit:l1:${CardFieldChange.Url("https://example.org/new")}"), cards.writes)
        assertFalse(viewModel.uiState.value.isEditingLink)
    }

    @Test
    fun `a typed link title saves, a blank one doesn't`() = runTest {
        cards.cards.value = mapOf(link.id to link.copy(metadataTitle = "Example"))
        val viewModel = linkViewModel()
        assertTrue(viewModel.uiState.value.editsTitle)

        viewModel.saveTitle("   ")
        viewModel.saveTitle("Example")
        viewModel.saveTitle("Field notes")

        assertEquals(listOf("edit:l1:${CardFieldChange.MetadataTitle("Field notes")}"), cards.writes)
        assertEquals("Field notes", viewModel.uiState.value.card?.metadataTitle)
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

    private val palette = Card(
        id = "c1",
        creationTime = 0.0,
        type = CardType.Palette,
        colors = listOf(CardColor("#FF5500"), CardColor("#4ECDC4")),
    )

    @Test
    fun `adding a color sends its hex code once and says so`() = runTest {
        cards.cards.value = mapOf(palette.id to palette)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.addColor("red")
            viewModel.addColor("f50")
            viewModel.addColor(" 2a9d8f ")
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.palette.added", "#2A9D8F")), awaitItem())
        }
        assertEquals(listOf("edit:c1:${CardFieldChange.AddColor("#2A9D8F")}"), cards.writes)
        assertEquals("#2A9D8F", viewModel.uiState.value.card?.colors?.last()?.hex)
    }

    @Test
    fun `removing a color offers Undo, which adds it back`() = runTest {
        cards.cards.value = mapOf(palette.id to palette)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.removeColor("#4ECDC4")
            val note = awaitItem() as CardDetailEvent.Message
            assertEquals(UiText.of("native.card.palette.removed", "#4ECDC4"), note.text)
            assertEquals(listOf("#FF5500"), viewModel.uiState.value.card?.colors?.map { it.hex })

            note.undo!!.invoke()
        }
        assertEquals(
            listOf("edit:c1:${CardFieldChange.RemoveColor("#4ECDC4")}", "edit:c1:${CardFieldChange.AddColor("#4ECDC4")}"),
            cards.writes,
        )
        assertEquals(listOf("#FF5500", "#4ECDC4"), viewModel.uiState.value.card?.colors?.map { it.hex })
    }

    @Test
    fun `a color saved with alpha is removed by its RGB and Undo puts the stored color back`() = runTest {
        val withAlpha = palette.copy(colors = listOf(CardColor("#FF000080"), CardColor("#4ECDC4")))
        cards.cards.value = mapOf(withAlpha.id to withAlpha)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.removeColor("#ff000080")
            val note = awaitItem() as CardDetailEvent.Message
            assertEquals(UiText.of("native.card.palette.removed", "#FF0000"), note.text)

            note.undo!!.invoke()
        }
        assertEquals(
            listOf("edit:c1:${CardFieldChange.RemoveColor("#FF0000")}", "edit:c1:${CardFieldChange.AddColor("#FF000080")}"),
            cards.writes,
        )
    }

    @Test
    fun `the last color, a full palette and Trash change nothing`() = runTest {
        cards.cards.value = mapOf(palette.id to palette.copy(colors = listOf(CardColor("#FF5500"))))
        val viewModel = viewModel()
        viewModel.removeColor("#FF5500")

        cards.cards.value = mapOf(palette.id to palette.copy(colors = List(12) { CardColor("#%06X".format(it)) }))
        viewModel.addColor("#FF5500")

        cards.cards.value = mapOf(palette.id to palette.copy(isDeleted = true))
        viewModel.addColor("#000000")
        viewModel.removeColor("#4ECDC4")

        assertEquals(emptyList(), cards.writes)
    }

    @Test
    fun `a failed color change says the palette couldn't update`() = runTest {
        cards.cards.value = mapOf(palette.id to palette)
        cards.failingIds = setOf(palette.id)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.addColor("#000000")
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.palette.saveFailed")), awaitItem())
            viewModel.removeColor("#FF5500")
            assertEquals(CardDetailEvent.Message(UiText.of("native.card.palette.saveFailed")), awaitItem())
        }
        assertEquals(palette.colors, viewModel.uiState.value.card?.colors)
    }

    @Test
    fun `keep offline saves the card, says so, and the same item removes the copy`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.toggleKeepOffline()
            assertEquals(CardDetailEvent.Message(UiText.of("android.offline.kept")), awaitItem())
            assertTrue(viewModel.uiState.value.isKeptOffline)

            viewModel.toggleKeepOffline()
            assertEquals(CardDetailEvent.Message(UiText.of("android.offline.removed")), awaitItem())
        }
        assertFalse(viewModel.uiState.value.isKeptOffline)
        assertEquals(listOf("keep:c1", "unkeep:c1"), cards.writes)
    }

    @Test
    fun `a card that can't be kept says so`() = runTest {
        cards.cards.value = mapOf(card.id to card)
        cards.keepError = java.io.IOException("offline")
        val viewModel = viewModel()

        viewModel.events.test {
            viewModel.toggleKeepOffline()
            assertEquals(CardDetailEvent.Message(UiText.of("android.offline.keepFailed")), awaitItem())
        }
        assertFalse(viewModel.uiState.value.isKeptOffline)
    }

    @Test
    fun `a card still loading says it's offline once the connection has been down a few seconds`() = runTest {
        val neverLoads = object : CardsRepository by cards {
            override fun card(id: String): Flow<Result<Card?>> = flow { awaitCancellation() }
        }
        account.isConnected.value = false
        val viewModel = viewModel(neverLoads)

        assertFalse(viewModel.uiState.value.isOffline)
        advanceTimeBy(3_001)
        assertTrue(viewModel.uiState.value.isOffline)
        assertTrue(viewModel.uiState.value.isLoading)
    }
}
