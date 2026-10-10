package com.praveenjuge.teak.feature.settings

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.CurrentUser
import com.praveenjuge.teak.core.model.TeakMessages
import com.praveenjuge.teak.core.testing.FakeAccountRepository
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

    private fun newViewModel() = SettingsViewModel(account, preferences, TeakConfig("https://test.convex.cloud", "1.0.85", isDebug = true))

    @Test
    fun `shows usage out of the free limit and the plan`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertEquals("12 of 200 Cards", viewModel.uiState.value.usage)
        assertEquals("Free", viewModel.uiState.value.plan)
        assertEquals("ada@example.com", viewModel.uiState.value.email)

        account.currentUserFlow.value = Result.success(CurrentUser(id = "t", email = "a@b.c", hasPremium = true, cardCount = 1.0))
        assertEquals("1 Card", viewModel.uiState.value.usage)
        assertEquals("Pro", viewModel.uiState.value.plan)
    }

    @Test
    fun `changing the theme saves it`() = runTest {
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.setTheme(ThemePreference.Dark)
        assertEquals(ThemePreference.Dark, viewModel.uiState.value.theme)
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
    fun `deleting is blocked while account changes are paused`() = runTest {
        account.authMode.value = AuthMode("workos", signupsDisabled = false, accountChangesPaused = true, authKitClientId = "client_1")
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.requestDelete()
        assertEquals(DeleteStep.None, viewModel.uiState.value.deleteStep)
        assertEquals(TeakMessages.ACCOUNT_CHANGES_PAUSED, viewModel.uiState.value.error)
    }

    @Test
    fun `a failed deletion explains itself and keeps the account`() = runTest {
        account.deleteError = IllegalStateException("boom")
        val viewModel = newViewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.confirmDelete("delete account")
        assertEquals("Something went wrong while deleting your account.", viewModel.uiState.value.error)
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
