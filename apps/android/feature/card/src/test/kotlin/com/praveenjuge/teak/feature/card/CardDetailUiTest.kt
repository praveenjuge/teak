package com.praveenjuge.teak.feature.card

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
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
}
