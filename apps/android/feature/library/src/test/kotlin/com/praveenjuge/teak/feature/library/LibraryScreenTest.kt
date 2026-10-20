package com.praveenjuge.teak.feature.library

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import com.praveenjuge.teak.core.model.LinkPrice
import com.praveenjuge.teak.core.data.repository.PagedCards
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class LibraryScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun show(state: LibraryUiState, actions: LibraryActions) {
        composeRule.setContent {
            TeakTheme {
                LibraryScreen(state = state, searchState = TextFieldState(), selectedCardId = null, actions = actions)
            }
        }
    }

    @Test
    fun `an empty library offers to write a note`() {
        var wroteNote = false
        show(LibraryUiState(paged = PagedCards(isLoading = false)), LibraryActions(onWriteNote = { wroteNote = true }))

        composeRule.onNodeWithText("Let's add your first card!").assertExists()
        composeRule.onNodeWithText("Write a Note").performClick()

        assertTrue(wroteNote)
    }

    @Test
    fun `tapping a tile opens its card`() {
        var opened: String? = null
        val note = CardSummary(id = "n1", creationTime = 0.0, type = CardType.Text, title = "", previewText = "Buy milk")
        show(
            LibraryUiState(paged = PagedCards(cards = listOf(note), isLoading = false, isDone = true)),
            LibraryActions(onOpenCard = { opened = it }),
        )

        composeRule.onNodeWithContentDescription("Note, Buy milk").performClick()

        assertEquals("n1", opened)
    }

    @Test
    fun `long-pressing a tile offers archive and more like this`() {
        var similar: String? = null
        var archived: Pair<String, Boolean>? = null
        val link = CardSummary(id = "l1", creationTime = 0.0, type = CardType.Link, title = "Desk lamp", url = "https://example.com")
        show(
            LibraryUiState(paged = PagedCards(cards = listOf(link), isLoading = false, isDone = true)),
            LibraryActions(onMoreLikeThis = { similar = it }, onArchiveCard = { id, on -> archived = id to on }),
        )

        composeRule.onNodeWithContentDescription("Link, Desk lamp").performTouchInput { longClick() }
        composeRule.onNode(hasText("Archive") and hasAnyAncestor(isPopup())).performClick()
        assertEquals("l1" to true, archived)

        composeRule.onNodeWithContentDescription("Link, Desk lamp").performTouchInput { longClick() }
        composeRule.onNodeWithText("More like this").performClick()
        assertEquals("l1", similar)
    }

    @Test
    fun `a done product link reads its state and price`() {
        val link = CardSummary(
            id = "l1",
            creationTime = 0.0,
            type = CardType.Link,
            title = "Desk lamp",
            completedAt = 1.0,
            linkCategory = "product",
            linkPrice = LinkPrice(24.99, "USD"),
        )
        show(LibraryUiState(paged = PagedCards(cards = listOf(link), isLoading = false, isDone = true)), LibraryActions())
        composeRule.onNodeWithContentDescription("Link, Desk lamp, Marked as bought, \$24.99").assertExists()
    }

    @Test
    fun `TalkBack gets the tile menu as custom actions`() {
        var similar: String? = null
        val link = CardSummary(id = "l1", creationTime = 0.0, type = CardType.Link, title = "Desk lamp", url = "https://example.com")
        show(
            LibraryUiState(paged = PagedCards(cards = listOf(link), isLoading = false, isDone = true)),
            LibraryActions(onMoreLikeThis = { similar = it }),
        )
        val actions = composeRule.onNodeWithContentDescription("Link, Desk lamp").fetchSemanticsNode()
            .config[SemanticsActions.CustomActions]
        assertEquals(listOf("Select", "Archive", "More like this"), actions.map { it.label })
        composeRule.runOnIdle { actions.last().action() }
        assertEquals("l1", similar)
    }
}
