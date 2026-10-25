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
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import com.praveenjuge.teak.core.model.FileMetadata

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

    @Test
    fun `Teak's suggested tags offer Keep and Remove`() {
        val kept = mutableListOf<String>()
        val removed = mutableListOf<String>()
        val card = Card(id = "c1", creationTime = 0.0, type = CardType.Text, content = "Hello", tags = listOf("design"), aiTags = listOf("Design", "macro"))
        compose.setContent {
            CardDetailScreen(
                state = CardDetailUiState(isLoading = false, card = card),
                snackbarHostState = SnackbarHostState(),
                callbacks = CardDetailCallbacks(
                    onBack = {},
                    onEdit = {},
                    onSearchTag = {},
                    onKeepTag = { kept += it },
                    onRemoveSuggestedTag = { removed += it },
                ),
            )
        }

        compose.onNodeWithText("Suggested by Teak").performScrollTo().assertExists()
        // Semantics actions: the floating toolbar can sit over the last section in a short test window.
        compose.onNodeWithText("macro").performScrollTo().performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithContentDescription("Remove macro").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(listOf("macro"), kept)
        assertEquals(listOf("macro"), removed)
    }

    @Test
    fun `a link's title is edited in the top bar`() {
        val saved = mutableListOf<String>()
        val card = Card(id = "l1", creationTime = 0.0, type = CardType.Link, url = "https://example.com", metadataTitle = "Example")
        compose.setContent {
            CardDetailScreen(
                state = CardDetailUiState(isLoading = false, card = card),
                snackbarHostState = SnackbarHostState(),
                callbacks = CardDetailCallbacks(onBack = {}, onEdit = {}, onSearchTag = {}, onSaveTitle = { saved += it }),
            )
        }

        val field = compose.onNodeWithContentDescription("Title")
        field.performTextReplacement("Field notes")
        field.performImeAction()

        assertEquals(listOf("Field notes"), saved)
    }
}
