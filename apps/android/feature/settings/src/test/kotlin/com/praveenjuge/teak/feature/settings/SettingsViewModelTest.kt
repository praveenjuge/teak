package com.praveenjuge.teak.feature.settings

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.model.CurrentUser
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeLanguageRepository
import com.praveenjuge.teak.core.testing.FakePreferencesRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SettingsViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val account = FakeAccountRepository()
    private val preferences = FakePreferencesRepository()
    private val language = FakeLanguageRepository()

    private fun newViewModel() =
        SettingsViewModel(account, preferences, language, TeakConfig("https://test.convex.cloud", "1.0.85", isDebug = true))

    @Test
    fun `choosing a language saves it and offers Undo`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.chooseLanguage("de")
        assertEquals("de", viewModel.uiState.value.language)
        assertEquals(LanguageNotice.Changed(undoTo = "en"), viewModel.uiState.value.languageNotice)

        viewModel.undoLanguage()
        assertEquals("en", viewModel.uiState.value.language)
        assertEquals(listOf("de", "en"), language.saved)
    }

    @Test
    fun `a language that can't be saved switches back`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        language.saveError = IllegalStateException("offline")
        viewModel.chooseLanguage("ja")
        assertEquals("en", viewModel.uiState.value.language)
        assertEquals(LanguageNotice.Failed, viewModel.uiState.value.languageNotice)
    }

    @Test
    fun `shows usage out of the free limit and the plan`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertEquals(UiText.of("native.settings.usageFree", "12", "200"), viewModel.uiState.value.usage)
        assertEquals(UiText.of("native.card.plan.free"), viewModel.uiState.value.plan)
        assertEquals("ada@example.com", viewModel.uiState.value.email)

        account.currentUserFlow.value = Result.success(CurrentUser(id = "t", email = "a@b.c", hasPremium = true, cardCount = 1.0))
        assertEquals(UiText.of("native.common.cardCount", count = 1), viewModel.uiState.value.usage)
        assertEquals(UiText.verbatim("Pro"), viewModel.uiState.value.plan)
    }

    @Test
    fun `appearance shows before the account loads`() = runTest {
        account.currentUserFlow.value = null
        preferences.setTheme(ThemePreference.Dark)
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertEquals(ThemePreference.Dark, viewModel.uiState.value.theme)
        assertEquals("ada@example.com", viewModel.uiState.value.email)
        assertEquals(null, viewModel.uiState.value.usage)
        assertEquals(null, viewModel.uiState.value.plan)

        account.currentUserFlow.value = Result.failure(IllegalStateException("offline"))
        assertEquals(UiText.of("native.settings.notAvailable"), viewModel.uiState.value.usage)
        assertEquals(UiText.of("native.settings.notAvailable"), viewModel.uiState.value.plan)
    }

    @Test
    fun `changing the theme saves it`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.setTheme(ThemePreference.Dark)
        assertEquals(ThemePreference.Dark, viewModel.uiState.value.theme)
    }

    @Test
    fun `wallpaper colors are off until turned on`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertFalse(viewModel.uiState.value.useWallpaperColors)
        viewModel.setUseWallpaperColors(true)
        assertTrue(viewModel.uiState.value.useWallpaperColors)
        assertTrue(preferences.useWallpaperColors.value)
    }

    @Test
    fun `deleting needs the typed phrase`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.requestDelete()
        viewModel.continueDelete()
        viewModel.confirmDelete("delete")
        assertFalse(account.deleted)
        viewModel.confirmDelete("  Delete Account ")
        assertTrue(account.deleted)
    }

    @Test
    fun `a failed deletion explains itself and keeps the account`() = runTest {
        account.deleteError = IllegalStateException("boom")
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.confirmDelete("delete account")
        assertEquals(UiText.of("native.settings.deleteFailed"), viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isDeleting)
    }

    @Test
    fun `logging out asks first`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.requestSignOut()
        assertTrue(viewModel.uiState.value.confirmSignOut)
        assertFalse(account.signedOut)
        viewModel.signOut()
        assertTrue(account.signedOut)
    }
}
