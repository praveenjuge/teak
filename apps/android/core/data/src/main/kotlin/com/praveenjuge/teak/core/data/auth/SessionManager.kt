package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

enum class SignInOutcome { SignedIn, Cancelled }

@Singleton
class SessionManager @Inject constructor(
    private val store: SessionStore,
    private val api: WorkOsAuthApi,
    private val bootstrap: UserBootstrap,
    @ApplicationScope private val scope: CoroutineScope,
    private val clock: Clock,
) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    private val _tokens = MutableSharedFlow<String?>(extraBufferCapacity = 8)
    val tokens: SharedFlow<String?> = _tokens.asSharedFlow()

    private val mutex = Mutex()
    private var session: AuthSession? = null
    private var refreshJob: Job? = null

    val currentSession: AuthSession? get() = session

    suspend fun restore() {
        mutex.withLock {
            if (_state.value != SessionState.Loading) return
            session = store.loadSession()
            _state.value = session?.let { SessionState.SignedIn(it.user) } ?: SessionState.SignedOut
        }
        if (session != null) startRefreshLoop()
    }

    suspend fun beginSignIn(clientId: String, method: SignInMethod): String {
        val (url, pending) = api.startSignIn(clientId, method)
        store.savePending(pending)
        return url
    }

    /**
     * The account is linked with `ensureUser` before anything is saved, so a failed bootstrap
     * leaves the app signed out.
     */
    suspend fun completeSignIn(code: String?, state: String?, error: String?): SignInOutcome {
        val pending = store.loadPending()
        store.clearPending()
        if (error == "access_denied") return SignInOutcome.Cancelled
        if (error != null || pending == null || code.isNullOrEmpty() || state != pending.state) {
            throw SignInException.signInFailed()
        }
        val signedIn = api.exchangeCode(pending, code)
        bootstrap.ensureUser(signedIn.accessToken)
        commit(signedIn)
        return SignInOutcome.SignedIn
    }

    /**
     * A valid access token, refreshing first when it expires within a minute or [forceRefresh] is
     * set. Returns null when signed out. Throws [IOException] when offline, keeping the session.
     */
    suspend fun accessToken(forceRefresh: Boolean = false): String? = mutex.withLock {
        val current = session ?: return null
        if (!forceRefresh && current.expiresAtMillis - clock.now() > REFRESH_MARGIN_MS) {
            return current.accessToken
        }
        val refreshed = try {
            api.refresh(current.clientId, current.refreshToken)
        } catch (e: InvalidRefreshTokenException) {
            endSessionLocked()
            return null
        }
        if (!current.isSameAccount(refreshed)) {
            endSessionLocked()
            return null
        }
        session = refreshed
        store.saveSession(refreshed)
        _state.value = SessionState.SignedIn(refreshed.user)
        _tokens.tryEmit(refreshed.accessToken)
        refreshed.accessToken
    }

    suspend fun clear(): AuthSession? = mutex.withLock {
        val cleared = session
        endSessionLocked()
        cleared
    }

    private suspend fun commit(newSession: AuthSession) {
        mutex.withLock {
            session = newSession
            store.saveSession(newSession)
            _state.value = SessionState.SignedIn(newSession.user)
        }
        _tokens.tryEmit(newSession.accessToken)
        startRefreshLoop()
    }

    private suspend fun endSessionLocked() {
        refreshJob?.cancel()
        refreshJob = null
        session = null
        store.clearSession()
        _state.value = SessionState.SignedOut
        _tokens.tryEmit(null)
    }

    private fun startRefreshLoop() {
        if (refreshJob?.isActive == true) return
        refreshJob = scope.launch {
            var backoff = INITIAL_BACKOFF_MS
            while (true) {
                val current = session ?: return@launch
                delay((current.expiresAtMillis - clock.now() - REFRESH_MARGIN_MS).coerceAtLeast(0))
                try {
                    accessToken()
                    backoff = INITIAL_BACKOFF_MS
                } catch (e: IOException) {
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
                } catch (e: SignInException) {
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
                }
            }
        }
    }

    companion object {
        const val REFRESH_MARGIN_MS = 60_000L
        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 60_000L
    }
}

fun interface Clock {
    fun now(): Long
}
