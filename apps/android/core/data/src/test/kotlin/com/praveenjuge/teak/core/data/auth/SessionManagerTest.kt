package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.InMemorySessionStore
import com.praveenjuge.teak.core.data.Tokens
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionManagerTest {
    private val store = InMemorySessionStore()
    private var now = 1_000_000_000L

    private class FakeApi : WorkOsAuthApi {
        var refreshes = 0
        var nextRefresh: () -> AuthSession = { error("no refresh queued") }
        var exchanged: AuthSession? = null
        override fun startSignIn(clientId: String, method: SignInMethod) =
            "https://auth/${method.provider}" to PendingSignIn(clientId, "verifier", "state-1")
        override suspend fun exchangeCode(pending: PendingSignIn, code: String) = requireNotNull(exchanged)
        override suspend fun refresh(clientId: String, refreshToken: String): AuthSession {
            refreshes += 1
            return nextRefresh()
        }
    }

    private class FakeBootstrap(var error: SignInException? = null) : UserBootstrap {
        var calls = 0
        override suspend fun ensureUser(accessToken: String) {
            calls += 1
            error?.let { throw it }
        }
    }

    private val api = FakeApi()
    private val bootstrap = FakeBootstrap()

    private fun TestScope.manager() = SessionManager(store, api, bootstrap, backgroundScope, Clock { now })

    @Test
    fun `a fresh token is reused without refreshing`() = runTest {
        store.session = Tokens.session(expiresAtMillis = now + 300_000)
        val sessions = manager().apply { restore() }
        assertEquals(store.session?.accessToken, sessions.accessToken())
        assertEquals(0, api.refreshes)
    }

    @Test
    fun `a token within a minute of expiry is refreshed first and saved`() = runTest {
        store.session = Tokens.session(expiresAtMillis = now + 30_000)
        val refreshed = Tokens.session(expiresAtMillis = now + 300_000, refreshToken = "refresh_2")
        api.nextRefresh = { refreshed }
        val sessions = manager().apply { restore() }
        assertEquals(refreshed.accessToken, sessions.accessToken())
        assertEquals("refresh_2", store.session?.refreshToken)
    }

    @Test
    fun `a rejected refresh token signs out`() = runTest {
        store.session = Tokens.session(expiresAtMillis = now - 1)
        api.nextRefresh = { throw InvalidRefreshTokenException() }
        val sessions = manager().apply { restore() }
        assertNull(sessions.accessToken())
        assertEquals(SessionState.SignedOut, sessions.state.value)
        assertNull(store.session)
    }

    @Test
    fun `going offline keeps the session`() = runTest {
        store.session = Tokens.session(expiresAtMillis = now - 1)
        api.nextRefresh = { throw IOException("offline") }
        val sessions = manager().apply { restore() }
        assertFailsWith<IOException> { sessions.accessToken() }
        assertIs<SessionState.SignedIn>(sessions.state.value)
        assertTrue(store.session != null)
    }

    @Test
    fun `a refresh that switches accounts signs out`() = runTest {
        store.session = Tokens.session(expiresAtMillis = now - 1)
        api.nextRefresh = { Tokens.session(userId = "someone_else", expiresAtMillis = now + 300_000) }
        val sessions = manager().apply { restore() }
        assertNull(sessions.accessToken())
        assertEquals(SessionState.SignedOut, sessions.state.value)
    }

    @Test
    fun `sign-in links the account before saving the session`() = runTest {
        api.exchanged = Tokens.session(expiresAtMillis = now + 300_000)
        val sessions = manager().apply { restore() }
        sessions.beginSignIn("client_1", SignInMethod.Google)
        assertTrue(sessions.completeSignIn(code = "code", state = "state-1", error = null))
        assertEquals(1, bootstrap.calls)
        assertIs<SessionState.SignedIn>(sessions.state.value)
        assertNull(store.pending)
    }

    @Test
    fun `a failed account link leaves the app signed out`() = runTest {
        api.exchanged = Tokens.session(expiresAtMillis = now + 300_000)
        bootstrap.error = SignInException("Verify your email before opening your vault.")
        val sessions = manager().apply { restore() }
        sessions.beginSignIn("client_1", SignInMethod.EmailSignIn)
        val error = assertFailsWith<SignInException> { sessions.completeSignIn("code", "state-1", null) }
        assertEquals("Verify your email before opening your vault.", error.message)
        assertEquals(SessionState.SignedOut, sessions.state.value)
        assertNull(store.session)
    }

    @Test
    fun `a mismatched state is rejected and cancelling is quiet`() = runTest {
        val sessions = manager().apply { restore() }
        sessions.beginSignIn("client_1", SignInMethod.Google)
        assertFailsWith<SignInException> { sessions.completeSignIn("code", "forged", null) }
        sessions.beginSignIn("client_1", SignInMethod.Google)
        assertFalse(sessions.completeSignIn(null, "state-1", "access_denied"))
        assertEquals(0, bootstrap.calls)
    }
}
