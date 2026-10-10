package com.praveenjuge.teak.feature.library

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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

        composeRule.onNodeWithContentDescription("Text, Buy milk").performClick()

        assertEquals("n1", opened)
    }
}
