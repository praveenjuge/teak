package com.praveenjuge.teak.feature.card

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.onAllNodesWithText
import com.praveenjuge.teak.core.model.MarkdownListItem
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.FileMetadata
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CardDetailUiTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `markdown shows headings, list items and inline styles without their markers`() {
        compose.setContent {
            MarkdownText("# Trip plan\n\n- Pack **bags**\n  - Passport\n1. Book the `train`\n\n> Go early")
        }

        compose.onNode(isHeading() and hasText("Trip plan")).assertIsDisplayed()
        compose.onNodeWithText("Pack bags").assertIsDisplayed()
        compose.onNodeWithText("Passport").assertIsDisplayed()
        compose.onNodeWithText("Book the train").assertIsDisplayed()
        compose.onNodeWithText("Go early").assertIsDisplayed()
    }

    @Test
    fun `a note shows its table and ticks a task from its checkbox`() {
        val ticked = mutableListOf<MarkdownListItem>()
        compose.setContent {
            MarkdownText("| Plan | Price |\n| --- | --- |\n| Free | $0 |\n\n- [ ] Milk\n- [x] Bread", onToggleTask = { ticked += it })
        }

        compose.onNodeWithText("Plan").assertIsDisplayed()
        compose.onNodeWithText("$0").assertIsDisplayed()
        compose.onAllNodesWithText("|", substring = true).assertCountEquals(0)
        compose.onNode(hasText("Bread") and isToggleable()).assertIsOn()
        compose.onNode(hasText("Milk") and isToggleable()).assertIsOff().performClick()

        assertEquals(listOf(MarkdownListItem(0, "•", "Milk", checked = false, line = 4)), ticked)
    }

    @Test
    fun `tapping a tag searches for it`() {
        val searched = mutableListOf<String>()
        val card = Card(id = "c1", creationTime = 0.0, type = CardType.Text, content = "Hello", tags = listOf("design"))
        compose.setContent {
            CardDetailScreen(
                state = CardDetailUiState(isLoading = false, card = card),
                snackbarHostState = SnackbarHostState(),
                callbacks = CardDetailCallbacks(onBack = {}, onEdit = {}, onSearchTag = { searched += it }),
            )
        }

        compose.onNodeWithText("design").performScrollTo().performClick()

        assertEquals(listOf("design"), searched)
    }

    @Test
    fun `View document opens a PDF in the app's reader`() {
        var opened = 0
        val card = Card(
            id = "c1",
            creationTime = 0.0,
            type = CardType.Document,
            fileUrl = "https://files.test/deck.pdf",
            fileMetadata = FileMetadata(fileName = "deck.pdf", mimeType = "application/pdf"),
        )
        compose.setContent {
            CardDetailScreen(
                state = CardDetailUiState(isLoading = false, card = card),
                snackbarHostState = SnackbarHostState(),
                callbacks = CardDetailCallbacks(onBack = {}, onEdit = {}, onSearchTag = {}, onViewPdf = { opened += 1 }),
            )
        }

        compose.onNodeWithText("View document").performScrollTo().performClick()

        assertEquals(1, opened)
    }
}
