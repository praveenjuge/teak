package com.praveenjuge.teak

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Launches the real app. It fails if the native Convex client can't load (as JNA 5.14 couldn't on
 * 16 KB-page devices) or startup crashes, and passes once either sign-in or the library shows.
 */
@RunWith(AndroidJUnit4::class)
class LaunchSmokeTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun opensToSignInOrTheLibrary() {
        compose.waitUntil(timeoutMillis = 20_000) {
            listOf("Save Anything. Anywhere.", "Home").any { text ->
                compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
            }
        }
    }
}
