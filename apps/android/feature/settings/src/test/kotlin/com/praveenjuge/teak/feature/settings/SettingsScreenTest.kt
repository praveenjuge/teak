package com.praveenjuge.teak.feature.settings

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SettingsScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `Appearance opens a picker that marks the current theme and saves the chosen one`() {
        val chosen = mutableListOf<ThemePreference>()
        compose.setContent {
            SettingsScreen(
                state = SettingsUiState(theme = ThemePreference.Light),
                versionName = "1.0.0",
                onThemeChange = { chosen += it }, onWallpaperColorsChange = {}, onLanguageChange = {},
                onUndoLanguage = {}, onDismissLanguageNotice = {}, onSignOut = {}, onConfirmSignOut = {},
                onCancelSignOut = {}, onDelete = {}, onContinueDelete = {}, onConfirmDelete = {},
                onCancelDelete = {}, onDismissError = {}, onOpenLink = {},
            )
        }

        compose.onNodeWithText("Appearance").performClick()
        compose.onNode(isSelectable() and hasText("Light")).assertIsSelected()
        compose.onNode(isSelectable() and hasText("Dark")).performClick()

        assertEquals(listOf(ThemePreference.Dark), chosen)
        compose.onNodeWithText("Cancel").assertDoesNotExist()
    }
}
