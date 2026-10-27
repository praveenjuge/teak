package com.praveenjuge.teak.feature.auth

import android.net.Uri
import app.cash.turbine.test
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SignInException
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WelcomeViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val account = FakeAccountRepository(signedIn = false)
    private val controller = SignInController(account)
    // Built lazily so viewModelScope picks up the test main dispatcher, which the rule sets after construction.
    private val viewModel by lazy { WelcomeViewModel(account, controller) }

    @Test
    fun `signing in opens the provider's AuthKit page`() = runTest {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.openUrl.test {
            viewModel.signIn(SignInMethod.Apple)
            assertEquals("https://auth.example.com/authorize?provider=AppleOAuth", awaitItem())
        }
        assertEquals(SignInMethod.Apple, viewModel.uiState.value.pending)
    }

    @Test
    fun `hides sign-up when sign-ups are paused`() = runTest {
        account.authMode.value = AuthMode("workos", signupsDisabled = true, authKitClientId = "client_1")
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertTrue(viewModel.uiState.value.signupsDisabled)
    }

    @Test
    fun `the redirect signs in and clears the pending state`() = runTest {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.signIn(SignInMethod.Google)
        controller.handleCallback(Uri.parse("teak://auth/callback?code=abc&state=xyz"))
        assertIs<SessionState.SignedIn>(account.session.value)
        assertNull(viewModel.uiState.value.pending)
    }

    @Test
    fun `a failed exchange shows the reason`() = runTest {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        account.signInError = SignInException.verifyEmail()
        controller.handleCallback(Uri.parse("teak://auth/callback?code=abc&state=xyz"))
        assertEquals(UiText.of("native.errors.verifyEmail"), viewModel.uiState.value.error)
    }

    @Test
    fun `closing the browser without finishing re-enables the buttons`() = runTest {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.signIn(SignInMethod.EmailSignIn)
        viewModel.onReturnedWithoutRedirect()
        assertNull(viewModel.uiState.value.pending)
    }

    @Test
    fun `offline before the sign-in setup loads says so after a moment`() = runTest {
        account.authMode.value = null
        account.isConnected.value = false
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        assertFalse(viewModel.uiState.value.isOffline)
        advanceTimeBy(5_000)
        assertTrue(viewModel.uiState.value.isOffline)

        account.isConnected.value = true
        account.authMode.value = AuthMode("workos", signupsDisabled = false, authKitClientId = "client_1")
        assertFalse(viewModel.uiState.value.isOffline)
        assertTrue(viewModel.uiState.value.isConfigured)
    }

    @Test
    fun `a sign-in page that can't open shows an error and re-enables the buttons`() = runTest {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        viewModel.signIn(SignInMethod.Google)
        viewModel.onSignInPageUnavailable()
        assertNull(viewModel.uiState.value.pending)
        assertEquals(UiText.of("native.errors.signInFailed"), viewModel.uiState.value.error)
    }

    @Test
    fun `recognizes only the AuthKit callback`() {
        assertTrue(SignInController.isCallback(Uri.parse("teak://auth/callback?code=1")))
        assertEquals(false, SignInController.isCallback(Uri.parse("teak://save?text=hi")))
    }
}
