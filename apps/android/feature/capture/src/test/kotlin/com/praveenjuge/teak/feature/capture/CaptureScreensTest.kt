package com.praveenjuge.teak.feature.capture

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.upload.UploadStatus
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.feature.capture.share.ShareSheetContent
import com.praveenjuge.teak.feature.capture.share.ShareUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.util.UUID
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
// A tall screen, so every row of the Add list is on screen at once.
@Config(sdk = [36], qualifiers = "w411dp-h1200dp")
class CaptureScreensTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `each add row starts its own action`() {
        val tapped = mutableListOf<String>()
        compose.setContent {
            TeakTheme {
                AddScreen(
                    state = AddUiState(),
                    onWriteNote = { tapped += "note" },
                    onRecordVoice = { tapped += "voice" },
                    onPickMedia = { tapped += "media" },
                    onTakePhoto = { tapped += "camera" },
                    onPickFiles = { tapped += "files" },
                    onClearFinished = {},
                    onDismissAlert = {},
                )
            }
        }

        listOf("Note or Link", "Voice Memo", "Photos & Videos", "Camera", "Files").forEach {
            compose.onNodeWithText(it).performClick()
        }

        assertEquals(listOf("note", "voice", "media", "camera", "files"), tapped)
    }

    @Test
    fun `an upload stopped by the card limit explains the limit`() {
        val failed = UploadStatus(
            id = UUID.randomUUID(),
            fileName = "trip.mp4",
            state = UploadStatus.State.Failed,
            progress = 0f,
            error = "You've reached the Free plan's card limit.",
            errorCode = TeakException.CARD_LIMIT_REACHED,
        )
        compose.setContent {
            TeakTheme {
                AddScreen(AddUiState(uploads = listOf(failed)), {}, {}, {}, {}, {}, {}, {})
            }
        }

        compose.onNodeWithText("Card limit reached").assertExists()
        compose.onNodeWithText("You've reached the Free plan's card limit.").assertExists()
        compose.onNodeWithText("The Free plan holds 200 cards.").assertExists()
        compose.onNodeWithText("Clear").assertExists()
    }

    @Test
    fun `the note can only be saved once it has text`() {
        val text = TextFieldState()
        compose.setContent {
            TeakTheme {
                NoteComposerScreen(NoteComposerUiState(), text, onSave = {}, onBack = {}, onDismissError = {})
            }
        }

        compose.onNodeWithContentDescription("Save note").assertIsNotEnabled()
        compose.onNodeWithText("Write a note or paste a link").performTextInput("https://teakvault.com")
        compose.onNodeWithContentDescription("Save note").assertIsEnabled()
    }

    @Test
    fun `a partial share says how many items were saved`() {
        compose.setContent {
            TeakTheme {
                ShareSheetContent(ShareUiState.Partial(saved = 2, total = 3, detail = null), onOpenTeak = {}, onClose = {})
            }
        }

        compose.onNodeWithText("Saved 2 of 3").assertExists()
        compose.onNodeWithText("Close").assertExists()
    }
}
